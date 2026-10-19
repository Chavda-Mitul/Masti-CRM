import { beforeEach, describe, expect, it } from "vitest";
import { addDays, addMonths, isoWeekday, istDateTimeToUtc, istToday, toDbDate } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { nextOpenDay } from "../src/modules/holidays/blockedDays";
import { seedHolidays } from "../src/modules/holidays/holidays.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { decidedCase, receivedCase, saveCase, visaStaff, type Agent } from "./visaHelpers";

// The field staff app, phase 1 (docs/decisions/0015-field-staff-app.md): booking the collection boy to pick a case's
// documents up at Steps 1–2. The boy (an active FIELD user), an open office day and a time slot from the list; the
// address (with an optional Google Maps link); the client's email on file for their one-time code. One booked pickup
// per case, changed or cancelled while booked; the case is due at the slot's end. Phase 2: the delivery boy, once the
// passports are in our stock, booked by any Visa staff; the office handover calls him off.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

interface JobDto {
  id: string;
  kind: string;
  status: string;
  assignee: { id: string; name: string; mobile: string };
  day: string;
  slot: { id: number; name: string };
  address: string;
  mapLink: string | null;
  mobile: string;
  bookedBy: { name: string } | null;
  cancelledAt: string | null;
  cancelledBy: { name: string } | null;
}
interface CaseDto {
  updatedAt: string;
  dueAt: string | null;
  status: string;
  arrival: string | null;
  client: { email: string | null; address: string; mobile: string };
  fieldJobs: JobDto[];
}
type Body = Record<string, unknown>;

const ADDRESS = "B-702, Raghuvir Residency, Vesu, Surat 395007";
const load = async (agent: Agent, caseNo: string) => (await agent.get(`/api/visa/cases/${caseNo}`)).body.case as CaseDto;
const slot = (code: string) => prisma.fieldSlot.findUniqueOrThrow({ where: { code } });
const reason = async (code: string) => (await prisma.enquiryReason.findUniqueOrThrow({ where: { code } })).id;
/** The first day our office is open, `from` days out. */
const openDay = (from = 1) => nextOpenDay(addDays(istToday(), from), { office: true });

/** Aarti's France case at Step 1, the client's email and address on file, and Ramesh the collection boy. */
async function setup({ email = "rakesh@example.com" }: { email?: string | null } = {}) {
  const aarti = await visaStaff();
  const c = await saveCase(aarti);
  await prisma.client.update({ where: { id: c.client.id }, data: { email, addressLine: "B-702, Raghuvir Residency", area: "Vesu", city: "Surat", pincode: "395007" } });
  const ramesh = await createUser({ name: "Ramesh", mobile: "+919825000001", type: "FIELD" });
  return { aarti, c, ramesh };
}

/** "Book the collection boy" with the case's updatedAt as the page has it, Ramesh, 4–6 pm, unless `body` says otherwise. */
async function book(agent: Agent, caseNo: string, body: Body = {}) {
  // Read first: a request awaited inside another's .send(...) breaks supertest.
  const c = await load(agent, caseNo);
  const ramesh = await prisma.user.findUniqueOrThrow({ where: { mobile: "+919825000001" } });
  const defaults = { kind: "PICKUP", assigneeId: ramesh.id, day: await openDay(), slotId: (await slot("EVENING")).id, address: ADDRESS, updatedAt: c.updatedAt };
  return agent.post(`/api/visa/cases/${caseNo}/field-jobs`).send({ ...defaults, ...body });
}

describe("Book the collection boy (phase 1)", () => {
  it("books him: the job, Send collection boy, the case due at the slot's end, audited", async () => {
    const { aarti, c, ramesh } = await setup();
    const day = await openDay();
    const res = await book(aarti, c.caseNo, { day });
    expect(res.status).toBe(200);
    const after = res.body.case as CaseDto;
    expect(after.arrival).toBe("COLLECTION_BOY");
    expect(after.dueAt).toBe(istDateTimeToUtc(day, "18:00").toISOString());
    expect(after.fieldJobs).toHaveLength(1);
    expect(after.fieldJobs[0]).toMatchObject({
      kind: "PICKUP",
      status: "BOOKED",
      assignee: { id: ramesh.id, name: "Ramesh", mobile: "+919825000001" },
      day,
      slot: { name: "4–6 pm" },
      address: ADDRESS,
      mapLink: null,
      mobile: "+919825041234",
      bookedBy: { name: "Aarti Patel" },
      cancelledAt: null,
    });
    const job = await prisma.fieldJob.findUniqueOrThrow({ where: { id: after.fieldJobs[0]!.id }, include: { department: true } });
    expect(job.department.code).toBe("VISA");

    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: "field.job.book" } });
    expect(row).toMatchObject({ entityType: "FieldJob", entityId: job.id, clientId: c.client.id });
    expect(row.after).toMatchObject({ caseNo: c.caseNo, kind: "PICKUP", boy: "Ramesh", day, slot: "4–6 pm", address: ADDRESS, mapLink: null });
    // Users are deactivated, never deleted: the job keeps its boy.
    await expect(prisma.user.delete({ where: { id: ramesh.id } })).rejects.toThrow();
  });

  it("the case carries the client's address and email for the form; a Google Maps link is kept", async () => {
    const { aarti, c } = await setup();
    const before = await load(aarti, c.caseNo);
    expect(before.client).toMatchObject({ email: "rakesh@example.com", address: ADDRESS });
    expect(before.fieldJobs).toEqual([]);

    const bad = await book(aarti, c.caseNo, { mapLink: "https://example.com/maps/x" });
    expect(bad.status).toBe(400);
    expect(bad.body.issues.mapLink).toEqual(["Paste a Google Maps link, e.g. https://maps.app.goo.gl/…"]);
    const res = await book(aarti, c.caseNo, { mapLink: " https://maps.app.goo.gl/AbC123xyz " });
    expect(res.status).toBe(200);
    expect((res.body.case as CaseDto).fieldJobs[0]!.mapLink).toBe("https://maps.app.goo.gl/AbC123xyz");
  });

  it("lists the active field staff to pick from", async () => {
    const { aarti } = await setup();
    await createUser({ name: "Suresh", mobile: "+919825000002", type: "FIELD", isActive: false });
    const res = await aarti.get("/api/visa/field-staff");
    expect(res.status).toBe(200);
    expect(res.body.staff.map((s: { name: string }) => s.name)).toEqual(["Ramesh"]);
  });
});

describe("what is refused", () => {
  it("no email for the client's code, a second pickup, someone who isn't field staff", async () => {
    const { aarti, c } = await setup({ email: null });
    const noEmail = await book(aarti, c.caseNo);
    expect(noEmail.status).toBe(409);
    expect(noEmail.body).toMatchObject({ message: "Add the client's email first: the one-time code they give the boy goes there.", details: { code: "CLIENT_EMAIL_MISSING" } });

    await prisma.client.update({ where: { id: c.client.id }, data: { email: "rakesh@example.com" } });
    const aartiUser = await prisma.user.findUniqueOrThrow({ where: { email: "aarti@masti.test" } });
    expect((await book(aarti, c.caseNo, { assigneeId: aartiUser.id })).body.issues.assigneeId).toEqual(["Pick one of the field staff."]);
    const suresh = await createUser({ name: "Suresh", mobile: "+919825000002", type: "FIELD" });
    await prisma.user.update({ where: { id: suresh.id }, data: { isActive: false } });
    expect((await book(aarti, c.caseNo, { assigneeId: suresh.id })).body.issues.assigneeId).toEqual(["Pick one of the field staff."]);

    expect((await book(aarti, c.caseNo)).status).toBe(200);
    const twice = await book(aarti, c.caseNo);
    expect(twice.status).toBe(409);
    expect(twice.body.message).toBe("The collection boy is already booked for this case.");
    expect(await prisma.fieldJob.count()).toBe(1);
  });

  it("the day: past, a closed day, more than a year ahead; the slot: switched off or over today; a blank address", async () => {
    const { aarti, c } = await setup();
    const issue = async (body: Body, field: string) => {
      const res = await book(aarti, c.caseNo, body);
      expect(res.status).toBe(400);
      return res.body.issues[field] as string[];
    };
    expect(await issue({ day: addDays(istToday(), -1) }, "day")).toEqual(["Pick today or a later day."]);
    expect(await issue({ day: addDays(istToday(), 400) }, "day")).toEqual(["Pick a day within the next year."]);
    // Over today: a slot that ended a minute after midnight (nothing blocks today without the holiday seed).
    const early = await prisma.fieldSlot.create({ data: { code: "EARLY", name: "Midnight", startsAt: "00:00", endsAt: "00:01" } });
    expect(await issue({ day: istToday(), slotId: early.id }, "slotId")).toEqual(["Midnight is over for today. Pick a later slot or another day."]);
    await prisma.fieldSlot.update({ where: { id: early.id }, data: { isActive: false } });
    expect(await issue({ slotId: early.id }, "slotId")).toEqual(["Pick one of the time slots."]);
    expect(await issue({ address: "   " }, "address")).toEqual(["Enter the address."]);

    await seedHolidays(prisma); // the weekly Sunday off
    let sunday = addDays(istToday(), 1);
    while (isoWeekday(sunday) !== 7) sunday = addDays(sunday, 1);
    expect(await issue({ day: sunday }, "day")).toEqual(["Weekly off: our office is closed that day. Pick another."]);
    expect(await prisma.fieldJob.count()).toBe(0);
  });

  it("past Step 2, postponed, a stale page, and someone else's case", async () => {
    const { aarti, c } = await setup();
    await createUser({ name: "Kiran", email: "kiran@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    const seen = (await load(aarti, c.caseNo)).updatedAt;
    const ramesh = await prisma.user.findUniqueOrThrow({ where: { mobile: "+919825000001" } });
    const body = { kind: "PICKUP", assigneeId: ramesh.id, day: await openDay(), slotId: (await slot("EVENING")).id, address: ADDRESS, updatedAt: seen };
    expect((await (await loginAs("kiran@masti.test")).post(`/api/visa/cases/${c.caseNo}/field-jobs`).send(body)).status).toBe(403);
    expect((await book(aarti, c.caseNo, { updatedAt: "2026-01-01T00:00:00.000Z" })).body.details.code).toBe("STALE");

    await prisma.enquiry.update({
      where: { id: c.id },
      data: { status: "POSTPONED", reasonId: await reason("TRAVEL_DATES_MOVED"), resumeOn: toDbDate(addMonths(istToday(), 1)) },
    });
    expect((await book(aarti, c.caseNo)).body.message).toMatch(/postponed/);

    const prep = await prisma.departmentStage.findFirstOrThrow({ where: { code: "FILE_PREPARATION" } });
    await prisma.enquiry.update({ where: { id: c.id }, data: { status: "OPEN", reasonId: null, resumeOn: null, stageId: prep.id } });
    expect((await book(aarti, c.caseNo)).body.message).toBe("This case has moved past collecting documents.");
  });
});

describe("Change and Cancel", () => {
  it("changes the boy, day or slot (the due time follows), audited; an unchanged save writes nothing", async () => {
    const { aarti, c } = await setup();
    expect((await book(aarti, c.caseNo)).status).toBe(200);
    const before = await load(aarti, c.caseNo);
    const job = before.fieldJobs[0]!;
    const suresh = await createUser({ name: "Suresh", mobile: "+919825000002", type: "FIELD" });
    const later = await openDay(3);
    const morning = await slot("MORNING");
    const put = (body: Body) => aarti.put(`/api/visa/cases/${c.caseNo}/field-jobs/${job.id}`).send(body);

    const same = await put({ assigneeId: job.assignee.id, day: job.day, slotId: job.slot.id, address: job.address, mapLink: null, updatedAt: before.updatedAt });
    expect(same.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "field.job.update" } })).toBe(0);

    const res = await put({ assigneeId: suresh.id, day: later, slotId: morning.id, address: job.address, updatedAt: before.updatedAt });
    expect(res.status).toBe(200);
    const after = res.body.case as CaseDto;
    expect(after.fieldJobs[0]).toMatchObject({ id: job.id, status: "BOOKED", assignee: { name: "Suresh" }, day: later, slot: { name: "11 am – 1 pm" } });
    expect(after.dueAt).toBe(istDateTimeToUtc(later, "13:00").toISOString());
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: "field.job.update" } });
    expect(row.before).toMatchObject({ boy: "Ramesh", slot: "4–6 pm" });
    expect(row.after).toMatchObject({ boy: "Suresh", day: later, slot: "11 am – 1 pm" });
  });

  it("a change saved after someone else's is refused (STALE), even when theirs only changed the boy or address", async () => {
    const { aarti, c } = await setup();
    expect((await book(aarti, c.caseNo)).status).toBe(200);
    const opened = await load(aarti, c.caseNo);
    const job = opened.fieldJobs[0]!;
    const suresh = await createUser({ name: "Suresh", mobile: "+919825000002", type: "FIELD" });
    const put = (body: Body) => aarti.put(`/api/visa/cases/${c.caseNo}/field-jobs/${job.id}`).send(body);
    const as = { assigneeId: job.assignee.id, day: job.day, slotId: job.slot.id, address: job.address, mapLink: null };

    // Two dialogs open on the same job: one sends Suresh instead (same day and slot)...
    const first = await put({ ...as, assigneeId: suresh.id, updatedAt: opened.updatedAt });
    expect(first.status).toBe(200);
    expect((first.body.case as CaseDto).updatedAt).not.toBe(opened.updatedAt);
    // ...then the other, opened before, saves a new address with Ramesh still in it.
    const late = await put({ ...as, address: "A-12, Green Park, Adajan, Surat 395009", updatedAt: opened.updatedAt });
    expect(late.status).toBe(409);
    expect(late.body.details.code).toBe("STALE");
    expect((await prisma.fieldJob.findUniqueOrThrow({ where: { id: job.id }, include: { assignee: true } })).assignee.name).toBe("Suresh");
  });

  it("cancels a booked job, after which another can be booked; a cancelled job can't change; another case's is 404", async () => {
    const { aarti, c } = await setup();
    expect((await book(aarti, c.caseNo)).status).toBe(200);
    const seen = await load(aarti, c.caseNo);
    const job = seen.fieldJobs[0]!;
    const cancel = await aarti.post(`/api/visa/cases/${c.caseNo}/field-jobs/${job.id}/cancel`).send({ updatedAt: seen.updatedAt });
    expect(cancel.status).toBe(200);
    expect((cancel.body.case as CaseDto).fieldJobs[0]).toMatchObject({ status: "CANCELLED", cancelledBy: { name: "Aarti Patel" } });
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: "field.job.cancel" } })).after).toMatchObject({ status: "CANCELLED" });

    const fresh = (await load(aarti, c.caseNo)).updatedAt;
    const change = await aarti
      .put(`/api/visa/cases/${c.caseNo}/field-jobs/${job.id}`)
      .send({ assigneeId: job.assignee.id, day: job.day, slotId: job.slot.id, address: job.address, updatedAt: fresh });
    expect(change.status).toBe(409);
    expect(change.body.message).toBe("This job isn't booked any more.");
    expect((await book(aarti, c.caseNo)).status).toBe(200);
    expect((await load(aarti, c.caseNo)).fieldJobs.map((j) => j.status)).toEqual(["BOOKED", "CANCELLED"]);

    const other = await saveCase(aarti, { mobile: "98250 41299", clientName: "Asha Desai" });
    expect((await aarti.post(`/api/visa/cases/${other.caseNo}/field-jobs/${job.id}/cancel`).send({ updatedAt: fresh })).status).toBe(404);
  });

  it("postponing or cancelling the case calls the boy off; Client brings them waits for the pickup to be cancelled", async () => {
    const { aarti, c } = await setup();
    expect((await book(aarti, c.caseNo)).status).toBe(200);
    const brings = await aarti.patch(`/api/visa/cases/${c.caseNo}`).send({ arrival: "CLIENT_BRINGS" });
    expect(brings.status).toBe(409);
    expect(brings.body.message).toBe("Cancel the collection boy's pickup first.");

    const seen = (await load(aarti, c.caseNo)).updatedAt;
    const postponed = await aarti
      .post(`/api/enquiries/${c.caseNo}/postpone`)
      .send({ reasonId: await reason("TRAVEL_DATES_MOVED"), resumeOn: addMonths(istToday(), 1), updatedAt: seen });
    expect(postponed.status).toBe(200);
    const job = await prisma.fieldJob.findFirstOrThrow();
    expect(job).toMatchObject({ status: "CANCELLED" });
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: "field.job.cancel" } })).after).toMatchObject({ why: "case postponed" });
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: "enquiry.postpone" } })).after).toMatchObject({ fieldJobsCancelled: [{ id: job.id, kind: "PICKUP" }] });
  });
});

describe("the time-slot list (Decision 2)", () => {
  it("is seeded with the demo's; the Head or an HOD adds and switches slots off; staff can't", async () => {
    const aarti = await visaStaff();
    const list = await aarti.get("/api/masters/field-slots");
    expect(list.body.slots.map((s: { name: string }) => s.name)).toEqual(["11 am – 1 pm", "2–4 pm", "4–6 pm"]);
    const slotBody = { code: "late", name: "6–8 pm", startsAt: "18:00", endsAt: "20:00", sortOrder: 4 };
    expect((await aarti.post("/api/masters/field-slots").send(slotBody)).status).toBe(403);

    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const riya = await loginAs("riya@masti.test");
    const added = await riya.post("/api/masters/field-slots").send(slotBody);
    expect(added.status).toBe(201);
    expect(added.body.slot).toMatchObject({ code: "LATE", name: "6–8 pm" });
    const backwards = await riya.post("/api/masters/field-slots").send({ ...slotBody, code: "BACK", startsAt: "20:00", endsAt: "18:00" });
    expect(backwards.body.issues.endsAt).toEqual(["The slot must end after it starts."]);
    const off = await riya.patch(`/api/masters/field-slots/${added.body.slot.id}`).send({ isActive: false });
    expect(off.body.slot.isActive).toBe(false);
    const swapped = await riya.patch(`/api/masters/field-slots/${added.body.slot.id}`).send({ startsAt: "21:00" });
    expect(swapped.body.issues.endsAt).toEqual(["The slot must end after it starts."]);
    expect(await prisma.auditLog.count({ where: { action: { in: ["fieldSlot.create", "fieldSlot.update"] } } })).toBe(2);
  });
});

describe("the database", () => {
  it("keeps slot times, a job's address and mobile, a map link, and who cancelled together", async () => {
    await expect(prisma.fieldSlot.create({ data: { code: "BAD", name: "Bad", startsAt: "9:00", endsAt: "10:00" } })).rejects.toThrow(/FieldSlot_times/);
    await expect(prisma.fieldSlot.create({ data: { code: "BAD", name: "Bad", startsAt: "18:00", endsAt: "17:00" } })).rejects.toThrow(/FieldSlot_times/);
    await expect(prisma.fieldSlot.create({ data: { code: "bad", name: "Bad", startsAt: "09:00", endsAt: "10:00" } })).rejects.toThrow(/FieldSlot_code_format/);

    const { aarti, c } = await setup();
    expect((await book(aarti, c.caseNo)).status).toBe(200);
    const job = await prisma.fieldJob.findFirstOrThrow();
    const set = (data: Record<string, unknown>) => prisma.fieldJob.update({ where: { id: job.id }, data });
    await expect(set({ address: " " })).rejects.toThrow(/FieldJob_address_mobile/);
    await expect(set({ mapLink: "http://maps.app.goo.gl/x" })).rejects.toThrow(/FieldJob_map_link/);
    await expect(set({ status: "CANCELLED" })).rejects.toThrow(/FieldJob_cancelled/);
    await expect(set({ cancelledAt: new Date(), cancelledById: job.createdById })).rejects.toThrow(/FieldJob_cancelled/);
    await set({ status: "CANCELLED", cancelledAt: new Date(), cancelledById: job.createdById });
  });
});

describe("Book the delivery boy (phase 2)", () => {
  /** Mehta's passports in our stock (receivedCase: Neha's), the client's email on file, Ramesh, and Kiran at the desk. */
  async function deliveryCase() {
    const d = await receivedCase();
    await prisma.client.update({ where: { id: d.c.client.id }, data: { email: "rakesh@example.com" } });
    await createUser({ name: "Ramesh", mobile: "+919825000001", type: "FIELD" });
    await createUser({ name: "Kiran Desai", email: "kiran@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    return { ...d, kiran: await loginAs("kiran@masti.test") };
  }
  /** A small "JPEG": the server checks a photo's first bytes, not the picture. */
  const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);

  it("any Visa staff books him for passports in our stock: the job, the case due at the slot's end, audited", async () => {
    const { c, kiran } = await deliveryCase();
    const before = await load(kiran, c.caseNo);
    const day = await openDay();
    const res = await book(kiran, c.caseNo, { kind: "DELIVERY", day });
    expect(res.status).toBe(200);
    const after = res.body.case as CaseDto;
    expect(after.fieldJobs[0]).toMatchObject({ kind: "DELIVERY", status: "BOOKED", assignee: { name: "Ramesh" }, day, slot: { name: "4–6 pm" }, bookedBy: { name: "Kiran Desai" } });
    expect(after.arrival).toBe(before.arrival);
    expect(after.dueAt).toBe(istDateTimeToUtc(day, "18:00").toISOString());
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: "field.job.book" } })).after).toMatchObject({ kind: "DELIVERY", boy: "Ramesh" });
  });

  it("not before the passports are in our stock, not twice, not without the client's email, not view-only", async () => {
    const { c, processor } = await decidedCase();
    await prisma.client.update({ where: { id: c.client.id }, data: { email: "rakesh@example.com" } });
    await createUser({ name: "Ramesh", mobile: "+919825000001", type: "FIELD" });
    const atDecision = await book(processor, c.caseNo, { kind: "DELIVERY" });
    expect(atDecision.status).toBe(409);
    expect(atDecision.body.message).toBe("Passports are handed over from Passport back.");
    const decided = (await load(processor, c.caseNo)).updatedAt;
    const expectedOn = await openDay(2);
    expect((await processor.post(`/api/visa/cases/${c.caseNo}/passports-back`).send({ collectedOn: istToday(), expectedOn, updatedAt: decided })).status).toBe(200);
    const inTransit = await book(processor, c.caseNo, { kind: "DELIVERY" });
    expect(inTransit.status).toBe(409);
    expect(inTransit.body.message).toBe("Mark the passports received first.");

    const other = await receivedCase({ extra: { mobile: "98250 41236", clientName: "Kiran Bhatt" }, vendorId: c.vendor.id });
    const noEmail = await book(processor, other.c.caseNo, { kind: "DELIVERY" });
    expect(noEmail.body.details.code).toBe("CLIENT_EMAIL_MISSING");
    await prisma.client.update({ where: { id: other.c.client.id }, data: { email: "kiran@example.com" } });
    expect((await book(processor, other.c.caseNo, { kind: "DELIVERY" })).status).toBe(200);
    const twice = await book(processor, other.c.caseNo, { kind: "DELIVERY" });
    expect(twice.status).toBe(409);
    expect(twice.body.message).toBe("The delivery boy is already booked for this case.");

    await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
    const seen = (await load(processor, other.c.caseNo)).updatedAt;
    const ramesh = await prisma.user.findUniqueOrThrow({ where: { mobile: "+919825000001" } });
    const body = { kind: "DELIVERY", assigneeId: ramesh.id, day: await openDay(), slotId: (await slot("EVENING")).id, address: ADDRESS, updatedAt: seen };
    expect((await (await loginAs("meena@masti.test")).post(`/api/visa/cases/${other.c.caseNo}/field-jobs`).send(body)).status).toBe(403);
  });

  it("a postponed case can have its delivery booked; its due time stays", async () => {
    const { c, kiran } = await deliveryCase();
    await prisma.enquiry.update({
      where: { id: c.id },
      data: { status: "POSTPONED", reasonId: await reason("TRAVEL_DATES_MOVED"), resumeOn: toDbDate(addMonths(istToday(), 1)) },
    });
    const before = await load(kiran, c.caseNo);
    const res = await book(kiran, c.caseNo, { kind: "DELIVERY" });
    expect(res.status).toBe(200);
    expect((res.body.case as CaseDto).dueAt).toBe(before.dueAt);
  });

  it("desk staff change and cancel it", async () => {
    const { c, processor, kiran } = await deliveryCase();
    expect((await book(processor, c.caseNo, { kind: "DELIVERY" })).status).toBe(200);
    const seen = await load(kiran, c.caseNo);
    const job = seen.fieldJobs[0]!;
    const morning = await slot("MORNING");
    const changed = await kiran
      .put(`/api/visa/cases/${c.caseNo}/field-jobs/${job.id}`)
      .send({ assigneeId: job.assignee.id, day: job.day, slotId: morning.id, address: job.address, updatedAt: seen.updatedAt });
    expect(changed.status).toBe(200);
    expect((changed.body.case as CaseDto).fieldJobs[0]!.slot.name).toBe("11 am – 1 pm");
    const fresh = (await load(kiran, c.caseNo)).updatedAt;
    const cancelled = await kiran.post(`/api/visa/cases/${c.caseNo}/field-jobs/${job.id}/cancel`).send({ updatedAt: fresh });
    expect(cancelled.status).toBe(200);
    expect((cancelled.body.case as CaseDto).fieldJobs[0]).toMatchObject({ status: "CANCELLED", cancelledBy: { name: "Kiran Desai" } });
  });

  it("the office handover calls a booked delivery off", async () => {
    const { c, processor } = await deliveryCase();
    expect((await book(processor, c.caseNo, { kind: "DELIVERY" })).status).toBe(200);
    const job = await prisma.fieldJob.findFirstOrThrow();
    const photo = await processor.post(`/api/visa/cases/${c.caseNo}/handover/photo`).set("Content-Type", "image/jpeg").send(JPEG);
    expect(photo.status).toBe(200);
    const seen = (await processor.get(`/api/visa/cases/${c.caseNo}`)).body.case;
    const handed = await processor.post(`/api/visa/cases/${c.caseNo}/handover`).send({
      mode: "OFFICE",
      booklets: { current: 2, old: 0 },
      receiver: { travellerId: seen.travellers[0].id },
      photoId: photo.body.photo.id,
      updatedAt: seen.updatedAt,
    });
    expect(handed.status).toBe(200);
    expect(await prisma.fieldJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "CANCELLED" });
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: "field.job.cancel" } })).after).toMatchObject({ why: "handed over at the office" });
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.handover" } })).after).toMatchObject({ fieldJobsCancelled: [{ id: job.id, kind: "DELIVERY" }] });
  });
});
