import { beforeEach, describe, expect, it } from "vitest";
import { addDays, istToday, toDbDate } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { nextOpenDay } from "../src/modules/holidays/blockedDays";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { app, createUser, loginAs, prisma, request, resetDb } from "./helpers";
import { receivedCase, saveCase, visaStaff } from "./visaHelpers";

// The field staff app, phase 4a (docs/decisions/0015-field-staff-app.md Decision 5): the boy's "Couldn't complete", with
// a reason from a list the Head or an HOD edits and the place his phone gave. The case comes back to the office, due
// now, to book again. Only his own stops, booked, on today's run.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

/** Where his phone says he is: Adajan, Surat, give or take 18.6 m. */
const PLACE = { lat: 21.1959, lng: 72.7933, accuracy: 18.6 };
const reasonId = async (code: string) => (await prisma.fieldFailReason.findUniqueOrThrow({ where: { code } })).id;

/**
 * Ramesh's pickup at Hiren Kapadia's today (Aarti's case at Step 1), and Suresh, another boy. Jobs are written straight
 * to the database, so the tests don't depend on the hour (booking refuses a slot that's over): booking itself is
 * tested in visaFieldJobs.test.ts.
 */
async function setup() {
  const ramesh = await createUser({ name: "Ramesh", mobile: "+919825000001", type: "FIELD" });
  await createUser({ name: "Suresh", mobile: "+919825000002", type: "FIELD" });
  const aarti = await visaStaff();
  const c = await saveCase(aarti, { mobile: "98250 41299", clientName: "Hiren Kapadia" });
  const aartiUser = await prisma.user.findUniqueOrThrow({ where: { email: "aarti@masti.test" } });
  const visa = await prisma.department.findUniqueOrThrow({ where: { code: "VISA" } });
  const slot = await prisma.fieldSlot.findUniqueOrThrow({ where: { code: "EVENING" } });
  const job = (data: Record<string, unknown> = {}) =>
    prisma.fieldJob.create({
      data: {
        departmentId: visa.id,
        kind: "PICKUP",
        enquiryId: c.id,
        assigneeId: ramesh.id,
        day: toDbDate(istToday()),
        slotId: slot.id,
        address: "12, Shantikunj Society, Adajan",
        mobile: "+919825041299",
        createdById: aartiUser.id,
        ...data,
      } as never,
    });
  const pickup = await job();
  return { ramesh, aarti, aartiUser, c, pickup, job, visa, slot };
}

const fail = (agent: Awaited<ReturnType<typeof loginAs>>, jobId: string, body: Record<string, unknown>) => agent.post(`/api/field/jobs/${jobId}/failed`).send(body);

describe("the reasons a visit fails", () => {
  it("are seeded; the Head or an HOD changes them, staff can't; the boy reads the ones switched on", async () => {
    const staff = await visaStaff();
    const list = await staff.get("/api/masters/field-fail-reasons");
    expect(list.status).toBe(200);
    expect(list.body.reasons.map((r: { name: string }) => r.name)).toEqual([
      "Client not home",
      "Wrong address",
      "Client asked to come later",
      "Not ready",
      "Client couldn't get the code",
      "Passports don't match our count",
    ]);
    expect((await staff.post("/api/masters/field-fail-reasons").send({ code: "RAIN", name: "Heavy rain" })).status).toBe(403);

    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const hod = await loginAs("riya@masti.test");
    const added = await hod.post("/api/masters/field-fail-reasons").send({ code: "rain", name: "Heavy rain", sortOrder: 7 });
    expect(added.status).toBe(201);
    expect(added.body.reason).toMatchObject({ code: "RAIN", name: "Heavy rain", isActive: true });
    await createUser({ name: "Vimal", email: "vimal@masti.test", type: "HEAD" });
    const head = await loginAs("vimal@masti.test");
    const off = await head.patch(`/api/masters/field-fail-reasons/${await reasonId("NOT_READY")}`).send({ isActive: false });
    expect(off.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: { in: ["fieldFailReason.create", "fieldFailReason.update"] } } })).toBe(2);

    await createUser({ name: "Ramesh", mobile: "+919825000001", type: "FIELD" });
    const boy = await loginAs("98250 00001");
    const his = await boy.get("/api/field/fail-reasons");
    expect(his.status).toBe(200);
    expect(his.body.reasons.map((r: { name: string }) => r.name)).toEqual([
      "Client not home",
      "Wrong address",
      "Client asked to come later",
      "Client couldn't get the code",
      "Passports don't match our count",
      "Heavy rain",
    ]);
    expect((await boy.get("/api/masters/field-fail-reasons")).status).toBe(403);
  });
});

describe("Couldn't complete (phase 4a)", () => {
  it("records the reason, the place and the time; the case comes back due now; the office sees it and books again", async () => {
    const { aarti, c, pickup, slot } = await setup();
    const before = await prisma.enquiry.findUniqueOrThrow({ where: { id: c.id } });
    const boy = await loginAs("98250 00001");

    const res = await fail(boy, pickup.id, { reasonId: await reasonId("CLIENT_NOT_HOME"), place: PLACE });
    expect(res.status).toBe(200);
    expect(res.body.stop).toMatchObject({ id: pickup.id, status: "FAILED", failReason: "Client not home" });
    expect(res.body.today).toBe(istToday());

    const job = await prisma.fieldJob.findUniqueOrThrow({ where: { id: pickup.id } });
    expect(job).toMatchObject({ status: "FAILED", latitude: 21.1959, longitude: 72.7933, accuracyM: 19 });
    expect(Math.abs(job.finishedAt!.getTime() - Date.now())).toBeLessThan(60_000);
    const after = await prisma.enquiry.findUniqueOrThrow({ where: { id: c.id } });
    expect(after.dueAt!.getTime()).toBe(job.finishedAt!.getTime());
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());

    const ramesh = await prisma.user.findFirstOrThrow({ where: { mobile: "+919825000001" } });
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: "field.job.fail" } });
    expect(entry).toMatchObject({
      actorId: ramesh.id,
      entityId: pickup.id,
      clientId: c.client.id,
      before: { status: "BOOKED" },
      after: { status: "FAILED", kind: "PICKUP", caseNo: c.caseNo, reason: "Client not home", place: { lat: 21.1959, lng: 72.7933, accuracy: 19 } },
    });

    // His run counts it as finished.
    expect((await boy.get("/api/field/jobs")).body).toMatchObject({ done: 1, total: 1, jobs: [{ status: "FAILED", failReason: "Client not home" }] });

    // The office sees why, when and where on the case, and books the boy again.
    const seen = (await aarti.get(`/api/visa/cases/${c.caseNo}`)).body.case;
    expect(seen.fieldJobs[0]).toMatchObject({
      id: pickup.id,
      status: "FAILED",
      failReason: { name: "Client not home" },
      place: { lat: 21.1959, lng: 72.7933, accuracy: 19 },
      finishedAt: job.finishedAt!.toISOString(),
    });
    await prisma.client.update({ where: { id: c.client.id }, data: { email: "hiren@example.com" } });
    const day = await nextOpenDay(addDays(istToday(), 1), { office: true });
    const again = await aarti
      .post(`/api/visa/cases/${c.caseNo}/field-jobs`)
      .send({ kind: "PICKUP", assigneeId: ramesh.id, day, slotId: slot.id, address: "12, Shantikunj Society, Adajan", updatedAt: seen.updatedAt });
    expect(again.status).toBe(200);
    expect(again.body.case.fieldJobs.map((j: { status: string }) => j.status)).toEqual(["BOOKED", "FAILED"]);
  });

  it("refuses another boy's stop, another day's, one already recorded or called off, a reason switched off, and no place", async () => {
    const { pickup, job, aartiUser } = await setup();
    const boy = await loginAs("98250 00001");
    const notHome = await reasonId("CLIENT_NOT_HOME");

    const other = await loginAs("98250 00002");
    expect((await fail(other, pickup.id, { reasonId: notHome, place: PLACE })).status).toBe(404);
    expect((await other.get(`/api/field/jobs/${pickup.id}`)).status).toBe(404);
    expect((await (await visaStaff()).post(`/api/field/jobs/${pickup.id}/failed`).send({ reasonId: notHome, place: PLACE })).status).toBe(403);
    expect((await request(app).post(`/api/field/jobs/${pickup.id}/failed`).send({ reasonId: notHome, place: PLACE })).status).toBe(401);

    const noPlace = await fail(boy, pickup.id, { reasonId: notHome });
    expect(noPlace.status).toBe(400);
    expect(noPlace.body.issues.place).toEqual(["Your phone's location is needed. Allow it, then try again."]);
    expect((await fail(boy, pickup.id, { reasonId: notHome, place: { ...PLACE, lat: 95 } })).status).toBe(400);
    expect((await fail(boy, pickup.id, { place: PLACE })).body.issues.reasonId).toEqual(["Pick a reason."]);
    await prisma.fieldFailReason.update({ where: { code: "NOT_READY" }, data: { isActive: false } });
    const off = await fail(boy, pickup.id, { reasonId: await reasonId("NOT_READY"), place: PLACE });
    expect(off.status).toBe(400);
    expect(off.body.issues.reasonId).toEqual(["Pick one of the reasons."]);

    const tomorrow = await job({ day: toDbDate(addDays(istToday(), 1)) });
    const ahead = await fail(boy, tomorrow.id, { reasonId: notHome, place: PLACE });
    expect(ahead.status).toBe(409);
    expect(ahead.body.message).toMatch(/^This stop is on \w{3} \d{1,2} \w{3,4}\. Record it on the day\.$/);
    const yesterday = await job({ day: toDbDate(addDays(istToday(), -1)) });
    expect((await fail(boy, yesterday.id, { reasonId: notHome, place: PLACE })).body.message).toMatch(/^This stop was on .+\. Ask the office to book it again\.$/);
    const called = await job({ status: "CANCELLED", cancelledAt: new Date(), cancelledById: aartiUser.id });
    expect((await fail(boy, called.id, { reasonId: notHome, place: PLACE })).body.message).toBe("The office called this stop off.");

    expect((await fail(boy, pickup.id, { reasonId: notHome, place: PLACE })).status).toBe(200);
    const twice = await fail(boy, pickup.id, { reasonId: notHome, place: PLACE });
    expect(twice.status).toBe(409);
    expect(twice.body.message).toBe("This stop is already recorded.");
    expect(await prisma.auditLog.count({ where: { action: "field.job.fail" } })).toBe(1);
  });

  it("works for a delivery too; a postponed case keeps its own due time", async () => {
    const ramesh = await createUser({ name: "Ramesh", mobile: "+919825000001", type: "FIELD" });
    const { c, processor } = await receivedCase();
    const postponeReason = (await prisma.enquiryReason.findUniqueOrThrow({ where: { code: "WAITING_LEAVE_APPROVAL" } })).id;
    const { updatedAt } = (await processor.get(`/api/visa/cases/${c.caseNo}`)).body.case;
    expect((await processor.post(`/api/enquiries/${c.caseNo}/postpone`).send({ reasonId: postponeReason, resumeOn: addDays(istToday(), 10), updatedAt })).status).toBe(200);
    const postponed = await prisma.enquiry.findUniqueOrThrow({ where: { id: c.id } });

    // Booked after the postponement (which calls booked jobs off), as the office handover's rule allows.
    const neha = await prisma.user.findUniqueOrThrow({ where: { email: "neha@masti.test" } });
    const visa = await prisma.department.findUniqueOrThrow({ where: { code: "VISA" } });
    const slot = await prisma.fieldSlot.findUniqueOrThrow({ where: { code: "MORNING" } });
    const delivery = await prisma.fieldJob.create({
      data: { departmentId: visa.id, kind: "DELIVERY", enquiryId: c.id, assigneeId: ramesh.id, day: toDbDate(istToday()), slotId: slot.id, address: "B-702, Raghuvir Residency, Vesu", mobile: "+919825041234", createdById: neha.id },
    });
    const boy = await loginAs("98250 00001");
    const res = await fail(boy, delivery.id, { reasonId: await reasonId("COME_LATER"), place: PLACE });
    expect(res.status).toBe(200);
    expect(res.body.stop).toMatchObject({ kind: "DELIVERY", status: "FAILED", failReason: "Client asked to come later", booklets: { current: 2, old: 0 } });
    const after = await prisma.enquiry.findUniqueOrThrow({ where: { id: c.id } });
    expect(after).toMatchObject({ status: "POSTPONED", dueAt: postponed.dueAt });
  });
});

describe("one of his stops", () => {
  it("is his only, with today by the server's clock", async () => {
    const { pickup, c } = await setup();
    const boy = await loginAs("98250 00001");
    const res = await boy.get(`/api/field/jobs/${pickup.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      today: istToday(),
      stop: { id: pickup.id, kind: "PICKUP", status: "BOOKED", day: istToday(), caseNo: c.caseNo, client: { name: "Hiren Kapadia" }, slot: { name: "4–6 pm" }, finishedAt: null, failReason: null },
    });
    expect(res.body.stop.pending.length).toBeGreaterThan(0);
    expect((await boy.get("/api/field/jobs/no-such-stop")).status).toBe(404);
  });
});
