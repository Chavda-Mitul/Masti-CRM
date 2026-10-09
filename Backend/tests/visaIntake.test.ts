import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, addMonths, istDateTimeToUtc, istToday } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { FIRST_FOLLOW_UP_KEY } from "../src/modules/visa/visa.settings";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { app, createUser, loginAs, prisma, request, resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

afterEach(() => {
  vi.useRealTimers();
});

const inTwoMonths = () => addMonths(istToday(), 2).slice(0, 7);

async function visaStaff(access: "VIEW" | "EDIT" = "EDIT") {
  await createUser({ name: "Aarti Patel", email: "aarti@masti.test", departments: [{ code: "VISA", access }] });
  return loginAs("aarti@masti.test");
}

async function franceTourist() {
  const fr = await prisma.country.findUniqueOrThrow({ where: { code: "FR" } });
  return prisma.visaOffering.findFirstOrThrow({ where: { countryId: fr.id } });
}

async function body(overrides: Record<string, unknown> = {}) {
  return {
    mobile: "98250 41234",
    clientName: "Rakesh Mehta",
    sourceCode: "WHATSAPP",
    offeringId: (await franceTourist()).id,
    adults: 2,
    children: 2,
    travelMonth: inTwoMonths(),
    travelDate: null,
    ...overrides,
  };
}

describe("POST /api/visa/cases: saving a visa enquiry", () => {
  it("creates the client, the case, placeholder travellers and their checklists, owned by the saver", async () => {
    const staff = await visaStaff();
    const res = await staff.post("/api/visa/cases").send(await body());
    expect(res.status).toBe(201);
    expect(res.body.clientCreated).toBe(true);
    const c = res.body.case;
    expect(c.caseNo).toBe(`VISA-${istToday().slice(0, 4)}-0001`);
    expect(c).toMatchObject({
      status: "OPEN",
      stage: { code: "ENQUIRY", step: 1, of: 8, statusLabel: "Enquiry saved", nextStepLabel: "Start collecting documents" },
      client: { mobile: "+919825041234", name: "Rakesh Mehta" },
      source: { code: "WHATSAPP", name: "WhatsApp" },
      origin: "STAFF",
      country: { label: "France (Schengen)" },
      visaType: { name: "Tourist" },
      adults: 2,
      children: 2,
      travelMonth: inTwoMonths(),
      owner: { name: "Aarti Patel" },
      createdBy: { name: "Aarti Patel" },
    });
    expect(c.travellers.map((t: { label: string }) => t.label)).toEqual(["Adult 1", "Adult 2", "Child 1", "Child 2"]);

    // Adults get ALL + ADULTS lines (11 of the seeded 14); children get ALL + CHILDREN (10).
    const [adult, , child] = c.travellers;
    expect(adult.documents).toHaveLength(11);
    expect(adult.pendingCount).toBe(11);
    expect(child.documents).toHaveLength(10);
    expect(adult.documents.map((d: { name: string }) => d.name)).toContain("Bank statement, last 6 months");
    expect(child.documents.map((d: { name: string }) => d.name)).toContain("Birth certificate");
    expect(child.documents.map((d: { name: string }) => d.name)).not.toContain("Salary slips, last 3 months");
    expect(adult.documents.find((d: { name: string }) => d.name === "Photos")).toMatchObject({ quantity: 2, detail: "35×45 mm, white background" });

    const client = await prisma.client.findUniqueOrThrow({ where: { mobile: "+919825041234" } });
    const actions = (await prisma.auditLog.findMany({ where: { clientId: client.id }, orderBy: { id: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(["client.create", "visa.case.create"]);
  });

  it("attaches to an existing client by main or extra number", async () => {
    const staff = await visaStaff();
    const user = await prisma.user.findFirstOrThrow();
    const cycle = await prisma.billingCycle.findFirstOrThrow({ where: { isDefault: true } });
    const rakesh = await prisma.client.create({ data: { mobile: "+919825041234", name: "Rakesh Mehta", billingCycleId: cycle.id } });
    await prisma.clientPhone.create({ data: { clientId: rakesh.id, mobile: "+919900011122", createdById: user.id } });

    const byMain = await staff.post("/api/visa/cases").send(await body());
    expect(byMain.status).toBe(201);
    expect(byMain.body.clientCreated).toBe(false);
    expect(byMain.body.case.client).toMatchObject({ id: rakesh.id, name: "Rakesh Mehta" });

    const byExtra = await staff.post("/api/visa/cases").send(await body({ mobile: "99000 11122" }));
    expect(byExtra.body.case.client.id).toBe(rakesh.id);
    expect(await prisma.client.count()).toBe(1);
  });

  it("needs the client's name for a new number, and never overwrites a name", async () => {
    const staff = await visaStaff();
    for (const clientName of [undefined, "", "  "]) {
      const res = await staff.post("/api/visa/cases").send(await body({ clientName }));
      expect(res.status, JSON.stringify(clientName)).toBe(400);
      expect(res.body.issues.clientName).toEqual(["Enter the client's name: this is a new number."]);
    }
    expect(await prisma.enquiry.count()).toBe(0);
    expect(await prisma.client.count()).toBe(0);
    expect(await prisma.caseCounter.count()).toBe(0);

    const named = await staff.post("/api/visa/cases").send(await body({ clientName: "Rakesh Mehta" }));
    expect(named.status).toBe(201);
    expect(named.body.case.client).toMatchObject({ name: "Rakesh Mehta" });

    // An existing client: another name from intake is ignored, and none is needed.
    const other = await staff.post("/api/visa/cases").send(await body({ clientName: "Someone Else" }));
    expect(other.body.case.client.name).toBe("Rakesh Mehta");
    expect((await staff.post("/api/visa/cases").send(await body({ clientName: undefined }))).status).toBe(201);
  });

  it("numbers cases in order, without gaps or repeats when saved at the same time", async () => {
    const staff = await visaStaff();
    const payload = await body();
    // Eight saves at once for one new number: they also race to create the client.
    const results = await Promise.all(Array.from({ length: 8 }, () => staff.post("/api/visa/cases").send(payload)));
    expect(results.map((r) => r.status)).toEqual(Array(8).fill(201));
    const numbers = results.map((r) => r.body.case.caseNo as string).sort();
    const year = istToday().slice(0, 4);
    expect(numbers).toEqual(Array.from({ length: 8 }, (_, i) => `VISA-${year}-${String(i + 1).padStart(4, "0")}`));
    expect(await prisma.client.count()).toBe(1);
  });

  it("starts a new series each calendar year (IST) and uses the department's prefix", async () => {
    const staff = await visaStaff();
    await prisma.department.update({ where: { code: "VISA" }, data: { casePrefix: "VS" } });
    const year = Number(istToday().slice(0, 4));
    const visa = await prisma.department.findUniqueOrThrow({ where: { code: "VISA" } });
    await prisma.caseCounter.create({ data: { departmentId: visa.id, year: year - 1, lastValue: 412 } });
    await prisma.caseCounter.create({ data: { departmentId: visa.id, year, lastValue: 9999 } });

    const res = await staff.post("/api/visa/cases").send(await body());
    expect(res.body.case.caseNo).toBe(`VS-${year}-10000`);

    // 31 Dec 19:00 UTC is already 1 Jan in India.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${year}-12-31T19:00:00.000Z`));
    const later = await loginAs("aarti@masti.test"); // the earlier session would have expired by then
    const next = await later.post("/api/visa/cases").send(await body({ travelMonth: `${year + 1}-02` }));
    expect(next.body.case.caseNo).toBe(`VS-${year + 1}-0001`);
  });

  it("returns the same case for a repeated Idempotency-Key", async () => {
    const staff = await visaStaff();
    const payload = await body();
    const first = await staff.post("/api/visa/cases").set("Idempotency-Key", "form-3f1c2a9e").send(payload);
    const again = await staff.post("/api/visa/cases").set("Idempotency-Key", "form-3f1c2a9e").send(payload);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.case.id).toBe(first.body.case.id);
    expect(await prisma.enquiry.count()).toBe(1);

    const both = await Promise.all([1, 2].map(() => staff.post("/api/visa/cases").set("Idempotency-Key", "form-double-click").send(payload)));
    expect(both.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(both[0]!.body.case.id).toBe(both[1]!.body.case.id);
    expect(await prisma.enquiry.count()).toBe(2);
  });

  it("sets the first follow-up from the visa.firstFollowUp setting", async () => {
    const staff = await visaStaff();
    const first = await staff.post("/api/visa/cases").send(await body());
    expect(new Date(first.body.case.dueAt)).toEqual(istDateTimeToUtc(addDays(istToday(), 1), "11:00"));

    await prisma.setting.upsert({
      where: { key: FIRST_FOLLOW_UP_KEY },
      update: { value: { afterDays: 2, at: "16:30" } },
      create: { key: FIRST_FOLLOW_UP_KEY, value: { afterDays: 2, at: "16:30" } },
    });
    const second = await staff.post("/api/visa/cases").send(await body());
    expect(new Date(second.body.case.dueAt)).toEqual(istDateTimeToUtc(addDays(istToday(), 2), "16:30"));
  });

  it("keeps the case's copy when the master checklist changes later", async () => {
    const staff = await visaStaff();
    const created = await staff.post("/api/visa/cases").send(await body({ adults: 1, children: 0 }));
    const offering = await franceTourist();
    await prisma.visaChecklistItem.deleteMany({ where: { offeringId: offering.id } });
    await prisma.documentMaster.update({ where: { code: "PASSPORT" }, data: { name: "Passport (renamed)" } });

    const res = await staff.get(`/api/visa/cases/${created.body.case.caseNo}`);
    expect(res.status).toBe(200);
    expect(res.body.case.travellers[0].documents).toHaveLength(11);
    expect(res.body.case.travellers[0].documents[0].name).toBe("Passport");
  });

  it("refuses bad input", async () => {
    const staff = await visaStaff();
    const lastMonth = addMonths(istToday(), -1).slice(0, 7);
    const month = inTwoMonths();
    const cases: [Record<string, unknown>, RegExp | string][] = [
      [{ mobile: "12345" }, /valid 10-digit/],
      [{ travelMonth: lastMonth }, /travel month can't be in the past/],
      [{ travelDate: `${month}-15`, travelMonth: addMonths(`${month}-01`, 1).slice(0, 7) }, "issues"],
      [{ adults: 0 }, "issues"],
      [{ adults: 31 }, "issues"],
      [{ children: -1 }, "issues"],
      [{ sourceCode: "WEBSITE_FORM" }, /came in/],
      [{ sourceCode: "NOPE" }, /came in/],
      [{ offeringId: 999 }, /don't process/],
    ];
    for (const [overrides, expected] of cases) {
      const res = await staff.post("/api/visa/cases").send(await body(overrides));
      expect(res.status, JSON.stringify(overrides)).toBe(400);
      if (expected === "issues") expect(res.body.issues, JSON.stringify(overrides)).toBeDefined();
      else expect(res.body.message).toMatch(expected);
    }

    const offering = await franceTourist();
    await prisma.visaOffering.update({ where: { id: offering.id }, data: { isActive: false } });
    expect((await staff.post("/api/visa/cases").send(await body())).body.message).toMatch(/don't process/);
    expect(await prisma.enquiry.count()).toBe(0);
    expect(await prisma.client.count()).toBe(0);
  });

  it("needs Visa EDIT", async () => {
    expect((await request(app).post("/api/visa/cases").send(await body())).status).toBe(401);
    const viewer = await visaStaff("VIEW");
    expect((await viewer.post("/api/visa/cases").send(await body())).status).toBe(403);
    expect((await viewer.get("/api/visa/offerings")).status).toBe(200);

    await createUser({ email: "hotels@masti.test", departments: [{ code: "HOTELS", access: "EDIT" }] });
    const hotels = await loginAs("hotels@masti.test");
    expect((await hotels.post("/api/visa/cases").send(await body())).status).toBe(403);

    await createUser({ name: "Ravi", mobile: "+919876500001", type: "FIELD" });
    const field = await loginAs("9876500001");
    expect((await field.get("/api/visa/offerings")).status).toBe(403);
  });
});

describe("intake dropdowns and settings", () => {
  it("lists only active offerings that have a checklist, grouped by country", async () => {
    const staff = await visaStaff();
    const cn = await prisma.country.findUniqueOrThrow({ where: { code: "CN" } });
    const tourist = await prisma.visaType.findUniqueOrThrow({ where: { code: "TOURIST" } });
    await prisma.visaOffering.create({ data: { countryId: cn.id, visaTypeId: tourist.id } }); // no checklist yet

    const res = await staff.get("/api/visa/offerings");
    expect(res.body.countries).toEqual([
      expect.objectContaining({ code: "FR", label: "France (Schengen)", visaTypes: [expect.objectContaining({ code: "TOURIST", name: "Tourist" })] }),
    ]);

    const sources = await staff.get("/api/enquiries/sources");
    expect(sources.body.sources.map((s: { code: string }) => s.code)).toEqual(["WHATSAPP", "LANDLINE", "MOBILE", "SOCIAL_MEDIA", "EMAIL"]);
  });

  it("lets only the Visa HOD or the Head change the follow-up timing, audited", async () => {
    const staff = await visaStaff();
    expect((await staff.get("/api/visa/settings")).body.settings).toEqual({ firstFollowUp: { afterDays: 1, at: "11:00" } });
    expect((await staff.put("/api/visa/settings").send({ firstFollowUp: { afterDays: 2, at: "10:00" } })).status).toBe(403);

    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const hod = await loginAs("riya@masti.test");
    expect((await hod.put("/api/visa/settings").send({ firstFollowUp: { afterDays: 2, at: "25:00" } })).status).toBe(400);
    const res = await hod.put("/api/visa/settings").send({ firstFollowUp: { afterDays: 2, at: "10:00" } });
    expect(res.body.settings.firstFollowUp).toEqual({ afterDays: 2, at: "10:00" });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "setting.update" } });
    expect(entry).toMatchObject({ entityId: FIRST_FOLLOW_UP_KEY, before: { afterDays: 1, at: "11:00" }, after: { afterDays: 2, at: "10:00" } });
  });

  it("lets the Visa HOD manage enquiry sources; codes never change", async () => {
    const staff = await visaStaff();
    expect((await staff.get("/api/masters/enquiry-sources")).body.sources).toHaveLength(7);
    expect((await staff.post("/api/masters/enquiry-sources").send({ code: "justdial", name: "Justdial" })).status).toBe(403);

    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const hod = await loginAs("riya@masti.test");
    const created = await hod.post("/api/masters/enquiry-sources").send({ code: "justdial", name: "Justdial", sortOrder: 6 });
    expect(created.status).toBe(201);
    expect(created.body.source).toMatchObject({ code: "JUSTDIAL", staffSelectable: true });
    expect((await hod.post("/api/masters/enquiry-sources").send({ code: "JUSTDIAL", name: "Again" })).status).toBe(409);

    const off = await hod.patch(`/api/masters/enquiry-sources/${created.body.source.id}`).send({ isActive: false, code: "OTHER" });
    expect(off.body.source).toMatchObject({ code: "JUSTDIAL", isActive: false });
    expect((await staff.get("/api/enquiries/sources")).body.sources.map((s: { code: string }) => s.code)).not.toContain("JUSTDIAL");
    expect(await prisma.auditLog.count({ where: { action: { startsWith: "enquirySource." } } })).toBe(2);
  });
});

describe("GET /api/clients/lookup: open enquiries", () => {
  it("lists the client's unfinished cases so staff can spot a duplicate", async () => {
    const staff = await visaStaff();
    expect((await staff.get("/api/clients/lookup?mobile=9825041234")).body).toMatchObject({ client: null, openEnquiries: [] });

    const first = (await staff.post("/api/visa/cases").send(await body())).body.case;
    const second = (await staff.post("/api/visa/cases").send(await body({ adults: 1, children: 0 }))).body.case;
    const lookup = await staff.get("/api/clients/lookup?mobile=98250%2041234");
    expect(lookup.status).toBe(200);
    expect(lookup.body.openEnquiries).toEqual([
      { caseNo: second.caseNo, department: "VISA", summary: "France (Schengen) · Tourist · 1 adult", stage: "Enquiry" },
      { caseNo: first.caseNo, department: "VISA", summary: "France (Schengen) · Tourist · 2 adults, 2 children", stage: "Enquiry" },
    ]);
  });

  it("keeps postponed cases, leaves out finished ones", async () => {
    const staff = await visaStaff();
    const postponed = (await staff.post("/api/visa/cases").send(await body())).body.case;
    const cancelled = (await staff.post("/api/visa/cases").send(await body())).body.case;
    await prisma.enquiry.update({ where: { id: postponed.id }, data: { status: "POSTPONED" } });
    await prisma.enquiry.update({ where: { id: cancelled.id }, data: { status: "CANCELLED" } });

    const open = (await staff.get("/api/clients/lookup?mobile=9825041234")).body.openEnquiries;
    expect(open.map((e: { caseNo: string }) => e.caseNo)).toEqual([postponed.caseNo]);
  });

  it("shows only departments the user can view", async () => {
    const staff = await visaStaff();
    await staff.post("/api/visa/cases").send(await body());
    await createUser({ name: "Hetal Shah", email: "hetal@masti.test", departments: [{ code: "HOLIDAYS", access: "EDIT" }] });
    const holidays = await loginAs("hetal@masti.test");

    const lookup = await holidays.get("/api/clients/lookup?mobile=9825041234");
    expect(lookup.body.client).not.toBeNull();
    expect(lookup.body.openEnquiries).toEqual([]);
  });
});
