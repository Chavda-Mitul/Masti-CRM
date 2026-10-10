import { beforeEach, describe, expect, it } from "vitest";
import { addDays, addMonths, istDateTimeToUtc, istToday, isoWeekday } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedHolidays } from "../src/modules/holidays/holidays.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";

// Postpone, cancel, resume and reassign (docs/decisions/0006-visa-documents.md Decision 6).

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

type Agent = Awaited<ReturnType<typeof loginAs>>;
type Saved = { id: string; caseNo: string; client: { id: string } };

async function visaStaff(name = "Aarti Patel", email = "aarti@masti.test") {
  await createUser({ name, email, departments: [{ code: "VISA", access: "EDIT" }] });
  return loginAs(email);
}

async function saveCase(agent: Agent, mobile = "98250 41234"): Promise<Saved> {
  const fr = await prisma.country.findUniqueOrThrow({ where: { code: "FR" } });
  const offering = await prisma.visaOffering.findFirstOrThrow({ where: { countryId: fr.id } });
  const res = await agent.post("/api/visa/cases").send({
    mobile,
    clientName: "Rakesh Mehta",
    sourceCode: "WHATSAPP",
    offeringId: offering.id,
    adults: 1,
    children: 0,
    travelMonth: addMonths(istToday(), 2).slice(0, 7),
  });
  expect(res.status).toBe(201);
  return res.body.case;
}

const reason = async (code: string) => (await prisma.enquiryReason.findUniqueOrThrow({ where: { code } })).id;
const updatedAtOf = async (id: string) => (await prisma.enquiry.findUniqueOrThrow({ where: { id } })).updatedAt.toISOString();

/** The first Sunday after tomorrow. */
function nextSunday() {
  let day = addDays(istToday(), 2);
  while (isoWeekday(day) !== 7) day = addDays(day, 1);
  return day;
}

describe("postpone, resume and cancel", () => {
  it("postpones with a postpone reason and a future date; it comes back on the next open day at 11:00", async () => {
    await seedHolidays(prisma); // the weekly Sunday off
    const staff = await visaStaff();
    const c = await saveCase(staff);
    const url = `/api/enquiries/${c.caseNo}/postpone`;
    const travelDatesMoved = await reason("TRAVEL_DATES_MOVED");
    const sunday = nextSunday();

    expect((await staff.post(url).send({ reasonId: await reason("TRIP_CANCELLED"), resumeOn: sunday, updatedAt: await updatedAtOf(c.id) })).body.issues.reasonId).toBeDefined();
    expect((await staff.post(url).send({ reasonId: travelDatesMoved, resumeOn: istToday(), updatedAt: await updatedAtOf(c.id) })).body.issues.resumeOn).toBeDefined();
    expect((await staff.post(url).send({ reasonId: travelDatesMoved, resumeOn: addMonths(istToday(), 13), updatedAt: await updatedAtOf(c.id) })).status).toBe(400);
    // Someone else changed the case after this page loaded it.
    expect((await staff.post(url).send({ reasonId: travelDatesMoved, resumeOn: sunday, updatedAt: "2026-01-01T00:00:00.000Z" })).status).toBe(409);

    const res = await staff.post(url).send({ reasonId: travelDatesMoved, resumeOn: sunday, updatedAt: await updatedAtOf(c.id) });
    expect(res.status).toBe(200);
    expect(res.body.enquiry).toMatchObject({ caseNo: c.caseNo, status: "POSTPONED" });
    const row = await prisma.enquiry.findUniqueOrThrow({ where: { id: c.id } });
    expect(row).toMatchObject({ status: "POSTPONED", reasonId: travelDatesMoved });
    // Sunday is closed: it comes back on Monday at the follow-up time.
    expect(row.dueAt).toEqual(istDateTimeToUtc(addDays(sunday, 1), "11:00"));

    const page = (await staff.get(`/api/visa/cases/${c.caseNo}`)).body.case;
    expect(page).toMatchObject({ status: "POSTPONED", resumeOn: sunday, reason: { code: "TRAVEL_DATES_MOVED", kind: "POSTPONE" } });
    // Postponed: nothing to tick until it is resumed.
    expect((await staff.post(`/api/visa/cases/${c.caseNo}/start`).set("Content-Type", "application/json")).status).toBe(409);

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "enquiry.postpone" } });
    expect(entry).toMatchObject({ clientId: c.client.id, before: { status: "OPEN" }, after: { status: "POSTPONED", resumeOn: sunday } });
  });

  it("resumes a postponed case: open again, due now, reason cleared", async () => {
    const staff = await visaStaff();
    const c = await saveCase(staff);
    expect((await staff.post(`/api/enquiries/${c.caseNo}/resume`).send({ updatedAt: await updatedAtOf(c.id) })).status).toBe(409);

    await staff.post(`/api/enquiries/${c.caseNo}/postpone`).send({ reasonId: await reason("WAITING_LEAVE_APPROVAL"), resumeOn: addDays(istToday(), 10), updatedAt: await updatedAtOf(c.id) });
    const before = Date.now();
    const res = await staff.post(`/api/enquiries/${c.caseNo}/resume`).send({ updatedAt: await updatedAtOf(c.id) });
    expect(res.status).toBe(200);
    const row = await prisma.enquiry.findUniqueOrThrow({ where: { id: c.id } });
    expect(row).toMatchObject({ status: "OPEN", reasonId: null, resumeOn: null });
    expect(row.dueAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(await prisma.auditLog.count({ where: { action: "enquiry.resume", clientId: c.client.id } })).toBe(1);
  });

  it("cancels an open or postponed case with a cancel reason; a cancelled case takes no more actions", async () => {
    const staff = await visaStaff();
    const open = await saveCase(staff);
    const postponed = await saveCase(staff);
    const tripCancelled = await reason("TRIP_CANCELLED");

    expect((await staff.post(`/api/enquiries/${open.caseNo}/cancel`).send({ reasonId: await reason("TRAVEL_DATES_MOVED"), updatedAt: await updatedAtOf(open.id) })).status).toBe(400);
    const cancelled = await staff.post(`/api/enquiries/${open.caseNo}/cancel`).send({ reasonId: tripCancelled, updatedAt: await updatedAtOf(open.id) });
    expect(cancelled.body.enquiry.status).toBe("CANCELLED");
    expect(await prisma.enquiry.findUniqueOrThrow({ where: { id: open.id } })).toMatchObject({ status: "CANCELLED", reasonId: tripCancelled, dueAt: null });

    await staff.post(`/api/enquiries/${postponed.caseNo}/postpone`).send({ reasonId: await reason("TRAVEL_DATES_MOVED"), resumeOn: addDays(istToday(), 5), updatedAt: await updatedAtOf(postponed.id) });
    const fromPostponed = await staff.post(`/api/enquiries/${postponed.caseNo}/cancel`).send({ reasonId: await reason("NO_REPLY"), updatedAt: await updatedAtOf(postponed.id) });
    expect(fromPostponed.status).toBe(200);
    expect(await prisma.enquiry.findUniqueOrThrow({ where: { id: postponed.id } })).toMatchObject({ status: "CANCELLED", resumeOn: null });

    const fresh = await updatedAtOf(open.id);
    expect((await staff.post(`/api/enquiries/${open.caseNo}/cancel`).send({ reasonId: tripCancelled, updatedAt: fresh })).status).toBe(409);
    expect((await staff.post(`/api/enquiries/${open.caseNo}/postpone`).send({ reasonId: await reason("TRAVEL_DATES_MOVED"), resumeOn: addDays(istToday(), 5), updatedAt: fresh })).status).toBe(409);
    expect((await staff.post(`/api/enquiries/${open.caseNo}/resume`).send({ updatedAt: fresh })).status).toBe(409);
  });

  it("lets only the owner, the HOD and the Head postpone or cancel", async () => {
    const staff = await visaStaff();
    const c = await saveCase(staff);
    const body = async () => ({ reasonId: await reason("TRIP_CANCELLED"), updatedAt: await updatedAtOf(c.id) });

    const neha = await visaStaff("Neha", "neha@masti.test");
    expect((await neha.post(`/api/enquiries/${c.caseNo}/cancel`).send(await body())).status).toBe(403);
    await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
    expect((await (await loginAs("meena@masti.test")).post(`/api/enquiries/${c.caseNo}/cancel`).send(await body())).status).toBe(403);

    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    expect((await (await loginAs("riya@masti.test")).post(`/api/enquiries/${c.caseNo}/cancel`).send(await body())).status).toBe(200);
  });
});

describe("reassigning", () => {
  it("lets the HOD give a case to a colleague who can take visa cases, and the case follows its owner", async () => {
    const aarti = await visaStaff();
    const c = await saveCase(aarti);
    const neha = await visaStaff("Neha Joshi", "neha@masti.test");
    const nehaId = (await prisma.user.findUniqueOrThrow({ where: { email: "neha@masti.test" } })).id;
    const give = (agent: Agent, ownerId: string) => agent.put(`/api/enquiries/${c.caseNo}/owner`).send({ ownerId, updatedAt: "" });
    const giveFresh = async (agent: Agent, ownerId: string) =>
      agent.put(`/api/enquiries/${c.caseNo}/owner`).send({ ownerId, updatedAt: await updatedAtOf(c.id) });

    // Staff can't hand their case over.
    expect((await giveFresh(aarti, nehaId)).status).toBe(403);
    expect((await aarti.get(`/api/enquiries/${c.caseNo}/assignees`)).status).toBe(403);

    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const hod = await loginAs("riya@masti.test");

    // Not someone without Visa EDIT, nor an inactive user.
    await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
    await createUser({ name: "Harsh", email: "harsh@masti.test", departments: [{ code: "HOTELS", access: "EDIT" }] });
    await createUser({ name: "Old Staff", email: "old@masti.test", isActive: false, departments: [{ code: "VISA", access: "EDIT" }] });
    for (const email of ["meena@masti.test", "harsh@masti.test", "old@masti.test"]) {
      const id = (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
      const res = await giveFresh(hod, id);
      expect(res.status, email).toBe(400);
      expect(res.body.issues.ownerId).toBeDefined();
    }
    expect((await give(hod, nehaId)).status).toBe(400); // updatedAt must be sent

    const assignees = (await hod.get(`/api/enquiries/${c.caseNo}/assignees`)).body.assignees as { name: string; isOwner: boolean }[];
    expect(assignees.map((a) => a.name)).toEqual(["Aarti Patel", "Neha Joshi", "Riya"]);
    expect(assignees.find((a) => a.name === "Aarti Patel")!.isOwner).toBe(true);

    const res = await giveFresh(hod, nehaId);
    expect(res.status).toBe(200);
    expect((await neha.get(`/api/visa/cases/${c.caseNo}`)).body.case.owner).toMatchObject({ name: "Neha Joshi" });
    expect((await aarti.get(`/api/visa/cases/${c.caseNo}`)).status).toBe(403);

    // The Head can take it too.
    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
    const vimalId = (await prisma.user.findUniqueOrThrow({ where: { email: "vimal@masti.test" } })).id;
    expect((await giveFresh(hod, vimalId)).status).toBe(200);

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "enquiry.reassign" }, orderBy: { createdAt: "asc" } });
    expect(entry).toMatchObject({ clientId: c.client.id, after: { ownerId: nehaId } });
  });

  it("won't give a matured case to the person who collected its documents", async () => {
    const aarti = await visaStaff();
    const c = await saveCase(aarti);
    const aartiId = (await prisma.user.findUniqueOrThrow({ where: { email: "aarti@masti.test" } })).id;
    const filePrep = await prisma.departmentStage.findFirstOrThrow({ where: { code: "FILE_PREPARATION" } });
    await prisma.visaCase.update({ where: { enquiryId: c.id }, data: { maturedAt: new Date(), maturedById: aartiId } });
    await prisma.enquiry.update({ where: { id: c.id }, data: { stageId: filePrep.id, ownerId: null } });

    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const hod = await loginAs("riya@masti.test");
    const refused = await hod.put(`/api/enquiries/${c.caseNo}/owner`).send({ ownerId: aartiId, updatedAt: await updatedAtOf(c.id) });
    expect(refused.status).toBe(400);
    expect(refused.body.issues.ownerId[0]).toMatch(/collected the documents/);
    expect(((await hod.get(`/api/enquiries/${c.caseNo}/assignees`)).body.assignees as { name: string }[]).map((a) => a.name)).toEqual(["Riya"]);
  });
});
