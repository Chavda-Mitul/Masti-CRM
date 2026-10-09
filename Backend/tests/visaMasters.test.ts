import { beforeEach, describe, expect, it } from "vitest";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { app, createUser, loginAs, prisma, request, resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
});

async function visaHod() {
  await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
  return loginAs("riya@masti.test");
}

async function visaStaff(access: "VIEW" | "EDIT" = "EDIT") {
  await createUser({ name: "Aarti", email: "aarti@masti.test", departments: [{ code: "VISA", access }] });
  return loginAs("aarti@masti.test");
}

async function franceTourist() {
  const fr = await prisma.country.findUniqueOrThrow({ where: { code: "FR" } });
  return prisma.visaOffering.findFirstOrThrow({ where: { countryId: fr.id } });
}

async function documentId(code: string) {
  return (await prisma.documentMaster.findUniqueOrThrow({ where: { code } })).id;
}

describe("visa masters access", () => {
  it("needs a login, refuses field staff and other departments", async () => {
    expect((await request(app).get("/api/masters/countries")).status).toBe(401);
    await createUser({ name: "Ravi", mobile: "+919876500001", type: "FIELD" });
    const field = await loginAs("9876500001");
    expect((await field.get("/api/masters/countries")).status).toBe(403);
    expect((await field.get("/api/masters/embassies")).status).toBe(403);

    await createUser({ email: "hotels@masti.test", departments: [{ code: "HOTELS", access: "EDIT" }] });
    const hotels = await loginAs("hotels@masti.test");
    expect((await hotels.get("/api/masters/visa-offerings")).status).toBe(403);
    // Embassies are holiday targets for every department.
    expect((await hotels.get("/api/masters/embassies")).status).toBe(200);
  });

  it("lets Visa staff read but only the Visa HOD (or Head) change visa masters", async () => {
    const staff = await visaStaff("EDIT");
    expect((await staff.get("/api/masters/documents")).status).toBe(200);
    const res = await staff.post("/api/masters/countries").send({ code: "gb", name: "United Kingdom" });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Visa HOD/);

    const hod = await visaHod();
    expect((await hod.post("/api/masters/countries").send({ code: "gb", name: "United Kingdom" })).status).toBe(201);

    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
    const head = await loginAs("vimal@masti.test");
    expect((await head.post("/api/masters/visa-types").send({ code: "business", name: "Business" })).status).toBe(201);
  });

  it("lets any HOD change embassies, but not plain staff", async () => {
    const staff = await visaStaff("EDIT");
    const fr = await prisma.country.findUniqueOrThrow({ where: { code: "FR" } });
    const body = { code: "fr-del", countryId: fr.id, name: "French embassy, Delhi", city: "Delhi" };
    expect((await staff.post("/api/masters/embassies").send(body)).status).toBe(403);

    await createUser({ email: "acc-hod@masti.test", departments: [{ code: "ACCOUNTS", role: "HOD" }] });
    const accountsHod = await loginAs("acc-hod@masti.test");
    const res = await accountsHod.post("/api/masters/embassies").send(body);
    expect(res.status).toBe(201);
    expect(res.body.embassy.code).toBe("FR-DEL");
    expect(res.body.embassy.country.code).toBe("FR");
  });
});

describe("countries, visa types, documents and offerings", () => {
  it("stores codes uppercase, refuses a used code, and never changes a code", async () => {
    const hod = await visaHod();
    const created = await hod.post("/api/masters/countries").send({ code: " gb ", name: "United Kingdom", zone: "" });
    expect(created.status).toBe(201);
    expect(created.body.country).toMatchObject({ code: "GB", zone: null, isActive: true });

    const again = await hod.post("/api/masters/countries").send({ code: "GB", name: "Britain" });
    expect(again.status).toBe(409);

    const bad = await hod.post("/api/masters/countries").send({ code: "GBR", name: "Britain" });
    expect(bad.status).toBe(400);

    const patched = await hod.patch(`/api/masters/countries/${created.body.country.id}`).send({ code: "UK", name: "UK", zone: "Non-Schengen" });
    expect(patched.status).toBe(200);
    expect(patched.body.country).toMatchObject({ code: "GB", name: "UK", zone: "Non-Schengen" });

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "country.update" } });
    expect(audit.before).toEqual({ name: "United Kingdom", zone: null });
    expect(audit.after).toEqual({ name: "UK", zone: "Non-Schengen" });
  });

  it("writes nothing for an unchanged edit", async () => {
    const hod = await visaHod();
    const doc = await prisma.documentMaster.findUniqueOrThrow({ where: { code: "PASSPORT" } });
    const res = await hod.patch(`/api/masters/documents/${doc.id}`).send({ name: "Passport" });
    expect(res.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "document.update" } })).toBe(0);
  });

  it("filters lists by active", async () => {
    const hod = await visaHod();
    const cn = await prisma.country.findUniqueOrThrow({ where: { code: "CN" } });
    await hod.patch(`/api/masters/countries/${cn.id}`).send({ isActive: false });
    const all = await hod.get("/api/masters/countries");
    const active = await hod.get("/api/masters/countries?active=true");
    expect(all.body.countries.map((c: { code: string }) => c.code)).toEqual(["FR", "CN"]);
    expect(active.body.countries.map((c: { code: string }) => c.code)).toEqual(["FR"]);
  });

  it("creates a country × visa type once, from active masters only", async () => {
    const hod = await visaHod();
    const cn = await prisma.country.findUniqueOrThrow({ where: { code: "CN" } });
    const tourist = await prisma.visaType.findUniqueOrThrow({ where: { code: "TOURIST" } });

    const res = await hod.post("/api/masters/visa-offerings").send({ countryId: cn.id, visaTypeId: tourist.id });
    expect(res.status).toBe(201);
    expect(res.body.offering).toMatchObject({ label: "China · Tourist", checklistCount: 0, isActive: true });
    expect((await hod.post("/api/masters/visa-offerings").send({ countryId: cn.id, visaTypeId: tourist.id })).status).toBe(409);

    await hod.patch(`/api/masters/countries/${cn.id}`).send({ isActive: false });
    const business = await hod.post("/api/masters/visa-types").send({ code: "BUSINESS", name: "Business" });
    const inactive = await hod.post("/api/masters/visa-offerings").send({ countryId: cn.id, visaTypeId: business.body.visaType.id });
    expect(inactive.status).toBe(400);

    const list = await hod.get("/api/masters/visa-offerings");
    expect(list.body.offerings.map((o: { label: string; checklistCount: number }) => [o.label, o.checklistCount])).toEqual([
      ["France (Schengen) · Tourist", 14],
      ["China · Tourist", 0],
    ]);
  });

  it("won't switch off a document that is on an active checklist", async () => {
    const hod = await visaHod();
    const res = await hod.patch(`/api/masters/documents/${await documentId("PASSPORT")}`).send({ isActive: false });
    expect(res.status).toBe(409);
    expect(res.body.details).toMatchObject({ code: "IN_USE", offerings: [{ label: "France (Schengen) · Tourist" }] });

    const offering = await franceTourist();
    await hod.patch(`/api/masters/visa-offerings/${offering.id}`).send({ isActive: false });
    expect((await hod.patch(`/api/masters/documents/${await documentId("PASSPORT")}`).send({ isActive: false })).status).toBe(200);
  });
});

describe("checklists", () => {
  it("returns the seeded France Tourist list, split for adults and children", async () => {
    const staff = await visaStaff("VIEW");
    const offering = await franceTourist();
    const res = await staff.get(`/api/masters/visa-offerings/${offering.id}/checklist`);
    expect(res.status).toBe(200);
    expect(res.body.offering.label).toBe("France (Schengen) · Tourist");
    expect(res.body.adults.count).toBe(11);
    expect(res.body.children.count).toBe(10);
    const photos = res.body.items.find((i: { document: { code: string } }) => i.document.code === "PHOTOS");
    expect(photos).toMatchObject({ requirement: "ORIGINAL", appliesTo: "ALL", quantity: 2 });
    const birth = res.body.items.find((i: { document: { code: string } }) => i.document.code === "BIRTH_CERTIFICATE");
    expect(birth.appliesTo).toBe("CHILDREN");
  });

  it("replaces the whole list in order, and audits before/after", async () => {
    const hod = await visaHod();
    const offering = await franceTourist();
    const current = await hod.get(`/api/masters/visa-offerings/${offering.id}/checklist`);

    const res = await hod.put(`/api/masters/visa-offerings/${offering.id}/checklist`).send({
      updatedAt: current.body.offering.updatedAt,
      items: [
        { documentId: await documentId("VISA_FORM"), requirement: "ORIGINAL" },
        { documentId: await documentId("PASSPORT"), requirement: "ORIGINAL", note: "Valid 6 months after return" },
        { documentId: await documentId("BIRTH_CERTIFICATE"), requirement: "XEROX_OK", appliesTo: "CHILDREN" },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { document: { code: string }; sortOrder: number }) => [i.document.code, i.sortOrder])).toEqual([
      ["VISA_FORM", 1],
      ["PASSPORT", 2],
      ["BIRTH_CERTIFICATE", 3],
    ]);
    expect(res.body.items[1]).toMatchObject({ appliesTo: "ALL", quantity: 1, note: "Valid 6 months after return" });
    expect(res.body.adults.count).toBe(2);
    expect(res.body.children.count).toBe(3);
    expect(res.body.offering.updatedAt).not.toBe(current.body.offering.updatedAt);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "visaChecklist.replace" } });
    expect((audit.before as { items: unknown[] }).items).toHaveLength(14);
    expect((audit.after as { items: unknown[] }).items).toHaveLength(3);
  });

  it("refuses a stale save, a repeated document and a switched-off one", async () => {
    const hod = await visaHod();
    const offering = await franceTourist();
    const { body } = await hod.get(`/api/masters/visa-offerings/${offering.id}/checklist`);
    const passport = await documentId("PASSPORT");

    const repeated = await hod
      .put(`/api/masters/visa-offerings/${offering.id}/checklist`)
      .send({ updatedAt: body.offering.updatedAt, items: [{ documentId: passport, requirement: "ORIGINAL" }, { documentId: passport, requirement: "XEROX_OK" }] });
    expect(repeated.status).toBe(400);

    const old = await hod.post("/api/masters/documents").send({ code: "OLD_FORM", name: "Old form", isActive: false });
    const inactive = await hod
      .put(`/api/masters/visa-offerings/${offering.id}/checklist`)
      .send({ updatedAt: body.offering.updatedAt, items: [{ documentId: old.body.document.id, requirement: "ORIGINAL" }] });
    expect(inactive.status).toBe(400);

    const first = await hod
      .put(`/api/masters/visa-offerings/${offering.id}/checklist`)
      .send({ updatedAt: body.offering.updatedAt, items: [{ documentId: passport, requirement: "ORIGINAL" }] });
    expect(first.status).toBe(200);
    const stale = await hod
      .put(`/api/masters/visa-offerings/${offering.id}/checklist`)
      .send({ updatedAt: body.offering.updatedAt, items: [{ documentId: passport, requirement: "XEROX_OK" }] });
    expect(stale.status).toBe(409);
    expect(stale.body.details).toEqual({ code: "STALE" });
    expect(await prisma.visaChecklistItem.count({ where: { offeringId: offering.id } })).toBe(1);
  });

  it("writes nothing when the list is unchanged", async () => {
    const hod = await visaHod();
    const offering = await franceTourist();
    const { body } = await hod.get(`/api/masters/visa-offerings/${offering.id}/checklist`);
    const items = body.items.map((i: { document: { id: number }; requirement: string; appliesTo: string; quantity: number; note: string | null }) => ({
      documentId: i.document.id,
      requirement: i.requirement,
      appliesTo: i.appliesTo,
      quantity: i.quantity,
      note: i.note,
    }));
    const res = await hod.put(`/api/masters/visa-offerings/${offering.id}/checklist`).send({ updatedAt: body.offering.updatedAt, items });
    expect(res.status).toBe(200);
    expect(res.body.offering.updatedAt).toBe(body.offering.updatedAt);
    expect(await prisma.auditLog.count({ where: { action: "visaChecklist.replace" } })).toBe(0);
  });

  it("is refused for Visa staff without HOD", async () => {
    const staff = await visaStaff("EDIT");
    const offering = await franceTourist();
    const { body } = await staff.get(`/api/masters/visa-offerings/${offering.id}/checklist`);
    const res = await staff
      .put(`/api/masters/visa-offerings/${offering.id}/checklist`)
      .send({ updatedAt: body.offering.updatedAt, items: [{ documentId: await documentId("PASSPORT"), requirement: "ORIGINAL" }] });
    expect(res.status).toBe(403);
  });
});

describe("the database", () => {
  it("refuses a checklist quantity outside 1–20 and a lowercase code", async () => {
    const offering = await franceTourist();
    await expect(
      prisma.visaChecklistItem.updateMany({ where: { offeringId: offering.id }, data: { quantity: 0 } }),
    ).rejects.toThrow();
    await expect(prisma.country.create({ data: { code: "gb", name: "UK" } })).rejects.toThrow();
  });
});
