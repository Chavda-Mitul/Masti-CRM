import { beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "../generated/prisma/client";
import { addDays, istDateTimeToUtc, istToday, isoWeekday, toDbDate } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedHolidays } from "../src/modules/holidays/holidays.seed";
import { todaySummary } from "../src/modules/today/today.service";
import { withDepartments } from "../src/modules/users/user";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { app, createUser, loginAs, prisma, request, resetDb } from "./helpers";
import { saveCase, visaStaff, type Agent } from "./visaHelpers";

// The Today page's banner and tiles (docs/decisions/0017-today-dashboard.md, component 1).

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

const reason = async (code: string) => (await prisma.enquiryReason.findUniqueOrThrow({ where: { code } })).id;
const userOf = (email: string) => prisma.user.findUniqueOrThrow({ where: { email }, include: withDepartments });

/** A France case saved by `agent` for a client of its own, then changed straight in the database. */
async function caseWith(agent: Agent, mobile: string, data: Prisma.EnquiryUncheckedUpdateInput) {
  const saved = await saveCase(agent, { mobile });
  await prisma.enquiry.update({ where: { id: saved.id }, data });
  return saved;
}

/** A Hotels enquiry made by hand: the department has no intake yet (as in enquiries.test.ts). */
async function hotelsEnquiry(dueAt: Date) {
  const hotels = await prisma.department.findUniqueOrThrow({ where: { code: "HOTELS" } });
  const stage = await prisma.departmentStage.create({
    data: { departmentId: hotels.id, flow: "HOTELS", code: "ENQUIRY", name: "Enquiry", sortOrder: 1, statusLabel: "New", nextStepLabel: "Check rates" },
  });
  const cycle = await prisma.billingCycle.findFirstOrThrow({ where: { isDefault: true } });
  const client = await prisma.client.create({ data: { mobile: "+919825000099", name: "Hotel Guest", billingCycleId: cycle.id } });
  const source = await prisma.enquirySource.findUniqueOrThrow({ where: { code: "LANDLINE" } });
  return prisma.enquiry.create({
    data: { caseNo: "HOT-2026-0001", departmentId: hotels.id, clientId: client.id, sourceId: source.id, stageId: stage.id, dueAt },
  });
}

async function today(agent: Agent) {
  const res = await agent.get("/api/today");
  expect(res.status).toBe(200);
  return res.body;
}

describe("GET /api/today", () => {
  it("counts each person's day: staff their own cases, an HOD the whole department, the Head everything", async () => {
    const yesterday = new Date(Date.now() - 86_400_000);
    const aarti = await visaStaff();
    await caseWith(aarti, "9825000001", { dueAt: yesterday });
    await caseWith(aarti, "9825000002", { dueAt: yesterday });
    await createUser({ name: "Neha Joshi", email: "neha@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    const neha = await loginAs("neha@masti.test");
    await caseWith(neha, "9825000003", { dueAt: yesterday });
    // Matured and waiting for a processor: nobody's yet, so only the HOD and the Head have it.
    await caseWith(aarti, "9825000004", { dueAt: yesterday, ownerId: null });
    await hotelsEnquiry(yesterday);

    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    await createUser({
      name: "Kiran",
      email: "kiran@masti.test",
      departments: [
        { code: "VISA", role: "HOD" },
        { code: "HOTELS", access: "VIEW" },
      ],
    });
    await createUser({ name: "Mona", email: "mona@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
    const of = async (email: string) => today(await loginAs(email));

    // Every case here is late and came in just now, so "late" and "new" both count the person's cases.
    expect(await today(aarti)).toMatchObject({ scope: { kind: "MINE", departments: [] }, late: 2, dueToday: 0, newEnquiries: 2 });
    expect(await today(neha)).toMatchObject({ scope: { kind: "MINE" }, late: 1, newEnquiries: 1 });
    expect(await of("riya@masti.test")).toMatchObject({ scope: { kind: "DEPARTMENTS", departments: ["Visa"] }, late: 4, newEnquiries: 4 });
    // A department they only view isn't theirs to work: the HOD's Hotels view adds nothing.
    expect(await of("kiran@masti.test")).toMatchObject({ scope: { kind: "DEPARTMENTS", departments: ["Visa"] }, late: 4, newEnquiries: 4 });
    // View-only staff own no cases, so their day is empty, like their Follow-ups badge.
    expect(await of("mona@masti.test")).toMatchObject({ scope: { kind: "MINE" }, late: 0, newEnquiries: 0, oldestLateAt: null });
    const head = await of("vimal@masti.test");
    expect(head).toMatchObject({ scope: { kind: "ALL" }, late: 5, newEnquiries: 5, oldestLateAt: yesterday.toISOString() });
    expect(head.scope.departments).toEqual(expect.arrayContaining(["Visa", "Hotels"]));

    // Field staff have their run on /tasks; nobody signed out gets anything.
    await createUser({ name: "Ravi", mobile: "+919876500001", type: "FIELD" });
    expect((await (await loginAs("9876500001")).get("/api/today")).status).toBe(403);
    expect((await request(app).get("/api/today")).status).toBe(401);
  });
});

describe("todaySummary", () => {
  it("counts late and due-today cases apart, only those someone has to act on, with the oldest late one", async () => {
    const aarti = await visaStaff();
    const day = istToday();
    const now = istDateTimeToUtc(day, "12:00");
    const oldest = istDateTimeToUtc(addDays(day, -2), "11:00");
    await caseWith(aarti, "9825000001", { dueAt: oldest });
    await caseWith(aarti, "9825000002", { dueAt: istDateTimeToUtc(day, "11:00") }); // earlier today: late already
    await caseWith(aarti, "9825000003", { dueAt: istDateTimeToUtc(day, "23:59") });
    await caseWith(aarti, "9825000004", { dueAt: istDateTimeToUtc(addDays(day, 1), "00:00") }); // tomorrow
    // Postponed and back today: due like any other. One away for a while isn't.
    const postponed = { status: "POSTPONED" as const, reasonId: await reason("TRAVEL_DATES_MOVED") };
    await caseWith(aarti, "9825000005", { dueAt: istDateTimeToUtc(day, "15:00"), resumeOn: toDbDate(day), ...postponed });
    await caseWith(aarti, "9825000006", { dueAt: istDateTimeToUtc(addDays(day, 20), "11:00"), resumeOn: toDbDate(addDays(day, 20)), ...postponed });
    // Cancelled with its passports still at our office: due to be handed back. A plain cancelled one needs nobody.
    const cancelled = { status: "CANCELLED" as const, reasonId: await reason("TRIP_CANCELLED") };
    const held = await caseWith(aarti, "9825000007", { dueAt: istDateTimeToUtc(day, "16:00"), ...cancelled });
    await prisma.visaCase.update({ where: { enquiryId: held.id }, data: { bookletsCurrent: 1 } });
    await caseWith(aarti, "9825000008", { dueAt: istDateTimeToUtc(addDays(day, -1), "11:00"), ...cancelled });

    expect(await todaySummary(await userOf("aarti@masti.test"), now)).toMatchObject({ late: 2, dueToday: 3, oldestLateAt: oldest });
  });

  it("counts new enquiries from 18:00 on the previous office day: on a Monday, from Saturday", async () => {
    await seedHolidays(prisma); // the weekly Sunday off, from today on
    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
    const vimal = await userOf("vimal@masti.test");
    const aarti = await visaStaff();
    let monday = addDays(istToday(), 1);
    while (isoWeekday(monday) !== 1) monday = addDays(monday, 1);
    const saturday = addDays(monday, -2);
    await caseWith(aarti, "9825000001", { createdAt: istDateTimeToUtc(saturday, "17:59") });
    await caseWith(aarti, "9825000002", { createdAt: istDateTimeToUtc(saturday, "18:00") });
    await caseWith(aarti, "9825000003", { createdAt: istDateTimeToUtc(addDays(monday, -1), "12:00") });
    await caseWith(aarti, "9825000004", { createdAt: istDateTimeToUtc(monday, "09:00") });

    const mondayMorning = istDateTimeToUtc(monday, "10:00");
    expect(await todaySummary(vimal, mondayMorning)).toMatchObject({ newEnquiries: 3, newSince: istDateTimeToUtc(saturday, "18:00") });
    // Tuesday counts from Monday evening.
    expect((await todaySummary(vimal, istDateTimeToUtc(addDays(monday, 1), "10:00"))).newSince).toEqual(istDateTimeToUtc(monday, "18:00"));

    // Masti moves the cut-off: from 09:00, Saturday's 17:59 enquiry counts too.
    await prisma.setting.create({ data: { key: "today", value: { newSinceAt: "09:00" } } });
    expect((await todaySummary(vimal, mondayMorning)).newEnquiries).toBe(4);
  });
});

describe("Today settings", () => {
  it("are everyone's to read; only the Head changes the cut-off, and the change is audited", async () => {
    const aarti = await visaStaff();
    expect((await aarti.get("/api/today/settings")).body).toEqual({ settings: { newSinceAt: "18:00" } });

    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const riya = await loginAs("riya@masti.test");
    expect((await riya.put("/api/today/settings").send({ newSinceAt: "19:00" })).status).toBe(403);

    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
    const vimal = await loginAs("vimal@masti.test");
    expect((await vimal.put("/api/today/settings").send({ newSinceAt: "25:00" })).status).toBe(400);
    const res = await vimal.put("/api/today/settings").send({ newSinceAt: "19:30" });
    expect(res.status).toBe(200);
    expect(res.body.settings).toEqual({ newSinceAt: "19:30" });
    expect((await aarti.get("/api/today/settings")).body.settings).toEqual({ newSinceAt: "19:30" });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "setting.update", entityId: "today" } });
    expect(entry).toMatchObject({ before: { newSinceAt: "18:00" }, after: { newSinceAt: "19:30" } });
  });
});
