import { beforeEach, describe, expect, it } from "vitest";
import { addMonths, istToday } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { app, createUser, loginAs, prisma, request, resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

type Agent = Awaited<ReturnType<typeof loginAs>>;

async function saveVisa(agent: Agent, mobile: string, extra: Record<string, unknown> = {}) {
  const offering = await prisma.visaOffering.findFirstOrThrow();
  const res = await agent.post("/api/visa/cases").send({
    mobile,
    clientName: "Test Client",
    sourceCode: "WHATSAPP",
    offeringId: offering.id,
    adults: 2,
    children: 1,
    travelMonth: addMonths(istToday(), 2).slice(0, 7),
    ...extra,
  });
  expect(res.status).toBe(201);
  return res.body.case as { id: string; caseNo: string };
}

/** A Hotels enquiry made directly: Hotels intake isn't built yet. */
async function hotelsEnquiry(clientMobile: string) {
  const hotels = await prisma.department.findUniqueOrThrow({ where: { code: "HOTELS" } });
  const stage = await prisma.departmentStage.create({
    data: { departmentId: hotels.id, code: "ENQUIRY", name: "Enquiry", sortOrder: 1, statusLabel: "New", nextStepLabel: "Check rates" },
  });
  const cycle = await prisma.billingCycle.findFirstOrThrow({ where: { isDefault: true } });
  const client = await prisma.client.create({ data: { mobile: clientMobile, name: "Hotel Guest", billingCycleId: cycle.id } });
  const source = await prisma.enquirySource.findUniqueOrThrow({ where: { code: "LANDLINE" } });
  return prisma.enquiry.create({
    data: { caseNo: "HOT-2026-0001", departmentId: hotels.id, clientId: client.id, sourceId: source.id, stageId: stage.id },
  });
}

async function setDue(id: string, dueAt: Date | null) {
  await prisma.enquiry.update({ where: { id }, data: { dueAt } });
}

describe("GET /api/enquiries", () => {
  it("lists late first, then by time due, with stage, summary and owner", async () => {
    await createUser({ name: "Aarti Patel", email: "aarti@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    const aarti = await loginAs("aarti@masti.test");
    const a = await saveVisa(aarti, "9825000001");
    const b = await saveVisa(aarti, "9825000002");
    const c = await saveVisa(aarti, "9825000003");
    const hour = 3_600_000;
    await setDue(a.id, new Date(Date.now() + 5 * hour));
    await setDue(b.id, new Date(Date.now() - 48 * hour));
    await setDue(c.id, null);

    const res = await aarti.get("/api/enquiries");
    expect(res.status).toBe(200);
    expect(res.body.enquiries.map((e: { caseNo: string }) => e.caseNo)).toEqual([b.caseNo, a.caseNo, c.caseNo]);
    expect(res.body.lateCount).toBe(1);
    expect(res.body.enquiries[0]).toMatchObject({
      department: { code: "VISA", name: "Visa" },
      summary: "France (Schengen) · Tourist · 2 adults, 1 child",
      stage: { code: "ENQUIRY", step: 1, of: 8, nextStepLabel: "Start collecting documents" },
      source: { code: "WHATSAPP" },
      owner: { name: "Aarti Patel" },
      client: { mobile: "+919825000002" },
    });
    // Only the departments Aarti can see, with counts and steps for the side panel.
    expect(res.body.departments).toEqual([expect.objectContaining({ code: "VISA", count: 3 })]);
    expect(res.body.departments[0].stages).toHaveLength(8);
  });

  it("shows each user only the departments they can view", async () => {
    await createUser({ name: "Aarti", email: "aarti@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    const aarti = await loginAs("aarti@masti.test");
    await saveVisa(aarti, "9825000001");
    await hotelsEnquiry("+919825000099");

    await createUser({ name: "Harsh", email: "hotels@masti.test", departments: [{ code: "HOTELS", access: "VIEW" }] });
    const hotels = await loginAs("hotels@masti.test");
    const mine = await hotels.get("/api/enquiries");
    expect(mine.body.enquiries.map((e: { caseNo: string }) => e.caseNo)).toEqual(["HOT-2026-0001"]);
    expect(mine.body.enquiries[0].summary).toBe("Hotels");
    expect((await hotels.get("/api/enquiries?department=VISA")).status).toBe(403);

    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
    const head = await loginAs("vimal@masti.test");
    const all = await head.get("/api/enquiries");
    expect(all.body.enquiries).toHaveLength(2);
    expect(all.body.departments.map((d: { code: string; count: number }) => [d.code, d.count])).toEqual([
      ["VISA", 1],
      ["HOLIDAYS", 0],
      ["HOTELS", 1],
      ["INSURANCE", 0],
      ["TICKETS", 0],
      ["ACCOUNTS", 0],
    ]);
    const visaOnly = await head.get("/api/enquiries?department=visa");
    expect(visaOnly.body.enquiries).toHaveLength(1);
    // The chips keep counting every department while one is picked.
    expect(visaOnly.body.departments.find((d: { code: string }) => d.code === "HOTELS").count).toBe(1);

    await createUser({ name: "Ravi", mobile: "+919876500001", type: "FIELD" });
    const field = await loginAs("9876500001");
    expect((await field.get("/api/enquiries")).status).toBe(403);
    expect((await request(app).get("/api/enquiries")).status).toBe(401);
  });

  it("filters by Only mine, search and status, and pages with a cursor", async () => {
    await createUser({ name: "Aarti", email: "aarti@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    await createUser({ name: "Neha", email: "neha@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    const aarti = await loginAs("aarti@masti.test");
    const neha = await loginAs("neha@masti.test");
    const a1 = await saveVisa(aarti, "9825041234");
    const a2 = await saveVisa(aarti, "9825000002");
    const n1 = await saveVisa(neha, "9825000003");
    await prisma.client.update({ where: { mobile: "+919825000002" }, data: { name: "Rakesh Mehta" } });

    const mine = await aarti.get("/api/enquiries?mine=true");
    expect(mine.body.enquiries.map((e: { id: string }) => e.id).sort()).toEqual([a1.id, a2.id].sort());

    const codes = async (q: string) => (await aarti.get(`/api/enquiries?q=${encodeURIComponent(q)}`)).body.enquiries.map((e: { caseNo: string }) => e.caseNo);
    expect(await codes(n1.caseNo.toLowerCase())).toEqual([n1.caseNo]);
    expect(await codes("rakesh")).toEqual([a2.caseNo]);
    expect(await codes("98250 41")).toEqual([a1.caseNo]);

    await prisma.enquiry.update({ where: { id: n1.id }, data: { status: "CANCELLED" } });
    expect((await aarti.get("/api/enquiries")).body.enquiries).toHaveLength(2);
    expect((await aarti.get("/api/enquiries?status=CANCELLED")).body.enquiries.map((e: { id: string }) => e.id)).toEqual([n1.id]);

    const page1 = await aarti.get("/api/enquiries?limit=1");
    expect(page1.body.enquiries).toHaveLength(1);
    const page2 = await aarti.get(`/api/enquiries?limit=1&cursor=${page1.body.nextCursor}`);
    expect(page2.body.enquiries).toHaveLength(1);
    expect(page2.body.nextCursor).toBeNull();
    expect(page2.body.enquiries[0].id).not.toBe(page1.body.enquiries[0].id);
  });
});
