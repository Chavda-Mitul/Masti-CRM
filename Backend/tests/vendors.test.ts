import { beforeEach, describe, expect, it } from "vitest";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { app, createUser, loginAs, prisma, request, resetDb } from "./helpers";

// The vendor master (docs/decisions/0007-visa-file-prep.md Decision 7).

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
});

type Agent = Awaited<ReturnType<typeof loginAs>>;

async function visaHod() {
  await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
  return loginAs("riya@masti.test");
}

async function visaStaff(access: "VIEW" | "EDIT" = "EDIT") {
  await createUser({ name: "Aarti", email: "aarti@masti.test", departments: [{ code: "VISA", access }] });
  return loginAs("aarti@masti.test");
}

const countryId = async (code: string) => (await prisma.country.findUniqueOrThrow({ where: { code } })).id;

/** "Global Visa Services", Mumbai, covering France. */
async function addVendor(agent: Agent, body: Record<string, unknown> = {}) {
  return agent.post("/api/masters/vendors").send({ name: "Global Visa Services", city: "Mumbai", countryIds: [await countryId("FR")], ...body });
}

describe("who can see and change vendors", () => {
  it("needs a login, and refuses field staff and other departments", async () => {
    expect((await request(app).get("/api/masters/vendors")).status).toBe(401);
    await createUser({ name: "Ravi", mobile: "+919876500001", type: "FIELD" });
    expect((await (await loginAs("9876500001")).get("/api/masters/vendors")).status).toBe(403);
    await createUser({ email: "hotels@masti.test", departments: [{ code: "HOTELS", access: "EDIT" }] });
    expect((await (await loginAs("hotels@masti.test")).get("/api/masters/vendors")).status).toBe(403);
  });

  it("lets Visa staff read, but only the Visa HOD or the Head add and change them", async () => {
    const hod = await visaHod();
    const created = await addVendor(hod);
    expect(created.status).toBe(201);
    const id = created.body.vendor.id as number;

    const staff = await visaStaff("EDIT");
    expect((await staff.get("/api/masters/vendors")).body.vendors).toHaveLength(1);
    const refused = await addVendor(staff, { city: "Delhi" });
    expect(refused.status).toBe(403);
    expect(refused.body.message).toMatch(/Visa HOD/);
    expect((await staff.patch(`/api/masters/vendors/${id}`).send({ isActive: false })).status).toBe(403);

    await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
    const viewOnly = await loginAs("meena@masti.test");
    expect((await viewOnly.get("/api/masters/vendors")).status).toBe(200);
    expect((await addVendor(viewOnly, { city: "Delhi" })).status).toBe(403);

    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
    expect((await addVendor(await loginAs("vimal@masti.test"), { city: "Delhi" })).status).toBe(201);
  });
});

describe("adding a vendor", () => {
  it("is approved as it is added: cleaned contact details, its countries by name, audited", async () => {
    const hod = await visaHod();
    const res = await addVendor(hod, {
      countryIds: [await countryId("FR"), await countryId("CN")],
      contactName: "Sanjay Kapoor",
      mobile: "98250 41234",
      email: "  Desk@GlobalVisa.example ",
    });
    expect(res.status).toBe(201);
    expect(res.body.vendor).toMatchObject({
      kind: "VISA_AGENT",
      name: "Global Visa Services",
      city: "Mumbai",
      contactName: "Sanjay Kapoor",
      mobile: "+919825041234",
      email: "desk@globalvisa.example",
      isActive: true,
    });
    expect(res.body.vendor.countries.map((c: { code: string }) => c.code)).toEqual(["CN", "FR"]);

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "vendor.create" } });
    expect(entry).toMatchObject({ entityType: "Vendor", entityId: String(res.body.vendor.id) });
    expect(entry.after).toMatchObject({ name: "Global Visa Services", mobile: "+919825041234" });
  });

  it("needs a name, a city and at least one active country; checks the contact details", async () => {
    const hod = await visaHod();
    const empty = await hod.post("/api/masters/vendors").send({ name: " ", city: "", countryIds: [] });
    expect(empty.status).toBe(400);
    expect(Object.keys(empty.body.issues)).toEqual(expect.arrayContaining(["name", "city", "countryIds"]));

    expect((await addVendor(hod, { countryIds: [999] })).body.issues.countryIds).toBeDefined();
    const cn = await countryId("CN");
    await prisma.country.update({ where: { id: cn }, data: { isActive: false } });
    expect((await addVendor(hod, { countryIds: [cn] })).body.issues.countryIds).toBeDefined();
    expect((await addVendor(hod, { countryIds: [await countryId("FR"), await countryId("FR")] })).status).toBe(400);

    expect((await addVendor(hod, { mobile: "12345" })).status).toBe(400);
    expect((await addVendor(hod, { email: "not-an-email" })).status).toBe(400);
    expect((await addVendor(hod, { contactName: "Sanjay 2" })).body.issues.contactName).toBeDefined();
    expect(await prisma.vendor.count()).toBe(0);
  });

  it("refuses the same name in the same city, whatever the capitals; another city is fine", async () => {
    const hod = await visaHod();
    expect((await addVendor(hod)).status).toBe(201);

    const twin = await addVendor(hod, { name: "GLOBAL visa services", city: "mumbai" });
    expect(twin.status).toBe(400);
    expect(twin.body.issues.name[0]).toMatch(/Global Visa Services in Mumbai is already a vendor/);
    expect((await addVendor(hod, { city: "Ahmedabad" })).status).toBe(201);

    // The database refuses it too, whatever the API checks.
    await expect(prisma.vendor.create({ data: { name: "Global VISA Services", city: "MUMBAI" } })).rejects.toThrow();
    await expect(prisma.vendor.create({ data: { name: "  ", city: "Pune" } })).rejects.toThrow();
  });
});

describe("changing a vendor", () => {
  it("replaces its countries, writes only real changes, and audits countryIds", async () => {
    const hod = await visaHod();
    const { id } = (await addVendor(hod)).body.vendor as { id: number };
    const [fr, cn] = [await countryId("FR"), await countryId("CN")];

    const changed = await hod.patch(`/api/masters/vendors/${id}`).send({ countryIds: [cn, fr], mobile: "9825041234" });
    expect(changed.status).toBe(200);
    expect(changed.body.vendor.countries.map((c: { code: string }) => c.code)).toEqual(["CN", "FR"]);
    expect(await prisma.vendorCountry.count({ where: { vendorId: id } })).toBe(2);

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "vendor.update" } });
    expect(entry.before).toEqual({ countryIds: [fr], mobile: null });
    expect(entry.after).toEqual({ countryIds: [Math.min(fr, cn), Math.max(fr, cn)], mobile: "+919825041234" });

    // The same values again, in another order and spelling, change nothing.
    const same = await hod.patch(`/api/masters/vendors/${id}`).send({ countryIds: [fr, cn], mobile: "+91 98250 41234", name: "Global Visa Services" });
    expect(same.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "vendor.update" } })).toBe(1);

    // Clearing the contact details.
    const cleared = await hod.patch(`/api/masters/vendors/${id}`).send({ mobile: "", email: null });
    expect(cleared.body.vendor).toMatchObject({ mobile: null, email: null });
  });

  it("keeps a country switched off since, but won't add one", async () => {
    const hod = await visaHod();
    const [fr, cn] = [await countryId("FR"), await countryId("CN")];
    const { id } = (await addVendor(hod, { countryIds: [fr, cn] })).body.vendor as { id: number };
    await prisma.country.update({ where: { id: cn }, data: { isActive: false } });

    expect((await hod.patch(`/api/masters/vendors/${id}`).send({ name: "Global Visa Services Pvt Ltd" })).status).toBe(200);
    expect((await hod.patch(`/api/masters/vendors/${id}`).send({ countryIds: [fr, cn] })).status).toBe(200);

    const other = (await addVendor(hod, { city: "Delhi" })).body.vendor as { id: number };
    const added = await hod.patch(`/api/masters/vendors/${other.id}`).send({ countryIds: [fr, cn] });
    expect(added.status).toBe(400);
    expect(added.body.issues.countryIds).toBeDefined();
  });

  it("refuses a rename into another vendor; a change of capitals on itself is fine", async () => {
    const hod = await visaHod();
    await addVendor(hod);
    const { id } = (await addVendor(hod, { name: "Shree Visa", city: "Mumbai" })).body.vendor as { id: number };

    const clash = await hod.patch(`/api/masters/vendors/${id}`).send({ name: "global visa services" });
    expect(clash.status).toBe(400);
    expect(clash.body.issues.name).toBeDefined();
    expect((await hod.patch(`/api/masters/vendors/${id}`).send({ name: "SHREE VISA" })).status).toBe(200);
    expect((await hod.patch("/api/masters/vendors/999").send({ name: "Nobody" })).status).toBe(404);
  });

  it("switches off rather than deleting; lists filter by active and by country", async () => {
    const hod = await visaHod();
    const [fr, cn] = [await countryId("FR"), await countryId("CN")];
    const mumbai = (await addVendor(hod)).body.vendor as { id: number };
    await addVendor(hod, { name: "China Visa Desk", city: "Delhi", countryIds: [cn] });

    expect((await hod.patch(`/api/masters/vendors/${mumbai.id}`).send({ isActive: false })).body.vendor.isActive).toBe(false);
    const names = async (query: string) => ((await hod.get(`/api/masters/vendors${query}`)).body.vendors as { name: string }[]).map((v) => v.name);
    expect(await names("")).toEqual(["China Visa Desk", "Global Visa Services"]);
    expect(await names("?active=true")).toEqual(["China Visa Desk"]);
    expect(await names(`?countryId=${fr}`)).toEqual(["Global Visa Services"]);
    expect(await names(`?active=true&countryId=${fr}`)).toEqual([]);
  });
});
