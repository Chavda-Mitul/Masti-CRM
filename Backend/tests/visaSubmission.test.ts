import { beforeEach, describe, expect, it } from "vitest";
import { addDays, addMonths, istDateTimeToUtc, istToday, isoWeekday, toDbDate } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { previousOpenDay } from "../src/modules/holidays/blockedDays";
import { seedHolidays } from "../src/modules/holidays/holidays.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { appointmentsHeld, dispatchCase, holdCaseLock, makeInvoiceable, mastiReady, untilWaitingOnLock, type Agent } from "./visaHelpers";

// Visa Step 5, "Submitted at the embassy" (docs/decisions/0011-visa-at-vendor.md Decisions 3 and 4): the vendor's file
// number, the embassy and the expected collection date, saved together and changeable at Step 5. The date can't be a day
// the embassy is closed, and the file comes back due the office day before it at 11:00 ⚠️.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

interface CaseDto {
  updatedAt: string;
  dueAt: string;
  stage: { code: string };
  submission: {
    vendorFileNo: string;
    embassy: { id: number; name: string; city: string };
    collectionOn: string;
    at: string;
    by: { name: string } | null;
  } | null;
}
type Case = Awaited<ReturnType<typeof dispatchCase>>;

const neha = () => loginAs("neha@masti.test");
const load = async (agent: Agent, caseNo: string) => (await agent.get(`/api/visa/cases/${caseNo}`)).body.case as CaseDto;
const reason = async (code: string) => (await prisma.enquiryReason.findUniqueOrThrow({ where: { code } })).id;
const mumbai = async () => (await prisma.embassy.findUniqueOrThrow({ where: { code: "FR-MUM" } })).id;

/** The first day on or after `from` that falls on this ISO weekday (1 = Monday … 7 = Sunday). */
function onWeekday(from: string, weekday: number) {
  let day = from;
  while (isoWeekday(day) !== weekday) day = addDays(day, 1);
  return day;
}
/** A Wednesday at least 10 days out: its day before is a Tuesday, well clear of today. */
const aWednesday = () => onWeekday(addDays(istToday(), 10), 3);

/** Saves the submission, with the case's updatedAt as the page has it (or `updatedAt`). */
async function submit(agent: Agent, caseNo: string, body: { vendorFileNo?: string; embassyId?: number; collectionOn?: string; updatedAt?: string }) {
  // Read first: a request awaited inside another's .send(...) breaks supertest.
  const updatedAt = body.updatedAt ?? (await load(agent, caseNo)).updatedAt;
  const embassyId = body.embassyId ?? (await mumbai());
  return agent
    .put(`/api/visa/cases/${caseNo}/submission`)
    .send({ vendorFileNo: "fr-mum 88421", collectionOn: aWednesday(), ...body, embassyId, updatedAt });
}

async function raise(agent: Agent, c: Case, clientName = "Rakesh Mehta") {
  await makeInvoiceable(agent, c, { clientName });
  const { quoteUpdatedAt, taxType, gstRatePercent, totalPaise } = (await agent.get(`/api/visa/cases/${c.caseNo}/invoice/check`)).body.preview;
  expect((await agent.post(`/api/visa/cases/${c.caseNo}/invoice`).send({ quoteUpdatedAt, taxType, gstRatePercent, totalPaise })).status).toBe(200);
}

/**
 * Mehta's file, Neha's, dispatched alone to Global Visa Services; the vendor got it unless `received` is false. Its
 * appointments have been (yesterday) unless `held` is false.
 */
async function withVendor({ received = true, held = true } = {}) {
  await mastiReady();
  const c = await dispatchCase();
  const processor = await neha();
  const seen = (await load(processor, c.caseNo)).updatedAt;
  expect((await processor.post(`/api/visa/cases/${c.caseNo}/docket`).send({ mode: "OWN", updatedAt: seen })).status).toBe(200);
  await raise(processor, c);
  const courier = await prisma.courier.findUniqueOrThrow({ where: { code: "BLUE_DART" } });
  expect((await processor.post(`/api/visa/cases/${c.caseNo}/dispatch`).send({ courierId: courier.id, awbNo: "12345678", caseNos: [c.caseNo] })).status).toBe(200);
  if (received) {
    const { updatedAt } = await load(processor, c.caseNo);
    expect((await processor.post(`/api/visa/cases/${c.caseNo}/vendor-received`).send({ updatedAt })).status).toBe(200);
  }
  if (held) await appointmentsHeld(c.id);
  return { c, processor };
}

/** A holiday on one day for these targets. */
async function closed(date: string, targets: { kind: "ALL_EMBASSIES" | "COUNTRY" | "EMBASSY" | "MASTI_OFFICE"; countryId?: number; embassyId?: number }[], name = "Dussehra") {
  await prisma.holiday.create({ data: { name, startDate: toDbDate(date), endDate: toDbDate(date), targets: { create: targets } } });
}

describe("Submitted at the embassy (Decisions 3 and 4)", () => {
  it("saves the file number, the embassy and the date together, due the office day before at 11:00", async () => {
    const { c, processor } = await withVendor();
    const on = aWednesday();
    const res = await submit(processor, c.caseNo, { collectionOn: on });
    expect(res.status).toBe(200);
    const after = res.body.case as CaseDto;
    expect(after.stage.code).toBe("AT_VENDOR");
    expect(after.submission).toMatchObject({ vendorFileNo: "FR-MUM88421", embassy: { name: "French embassy, Mumbai" }, collectionOn: on, by: { name: "Neha Joshi" } });
    expect(after.dueAt).toBe(istDateTimeToUtc(addDays(on, -1), "11:00").toISOString());

    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.submitted" } });
    expect(row).toMatchObject({ entityType: "Enquiry", entityId: c.id, clientId: c.client.id });
    expect(row.after).toMatchObject({ vendorFileNo: "FR-MUM88421", collectionOn: on, embassy: "French embassy, Mumbai" });
  });

  it("walks back over an office holiday, and follows the setting", async () => {
    const { c, processor } = await withVendor();
    const on = aWednesday();
    await closed(addDays(on, -1), [{ kind: "MASTI_OFFICE" }], "Office closed");
    const res = await submit(processor, c.caseNo, { collectionOn: on });
    expect((res.body.case as CaseDto).dueAt).toBe(istDateTimeToUtc(addDays(on, -2), "11:00").toISOString());

    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const hod = await loginAs("riya@masti.test");
    expect((await hod.put("/api/visa/settings").send({ collectionCheck: { daysBefore: 3, at: "10:30" } })).status).toBe(200);
    expect((await hod.put("/api/visa/settings").send({ collectionCheck: { daysBefore: 31, at: "10:30" } })).status).toBe(400);
    const later = addDays(on, 7);
    const moved = await submit(processor, c.caseNo, { collectionOn: later });
    expect((moved.body.case as CaseDto).dueAt).toBe(istDateTimeToUtc(addDays(later, -3), "10:30").toISOString());
  });

  it("never comes due before today: a collection tomorrow is due today", async () => {
    const { c, processor } = await withVendor();
    const tomorrow = addDays(istToday(), 1);
    await closed(istToday(), [{ kind: "MASTI_OFFICE" }], "Office closed");
    const res = await submit(processor, c.caseNo, { collectionOn: tomorrow });
    expect(res.status).toBe(200);
    expect((res.body.case as CaseDto).dueAt).toBe(istDateTimeToUtc(istToday(), "11:00").toISOString());
  });

  it("can be changed at Step 5: the stamp stays, the change is audited, and an unchanged save writes nothing", async () => {
    const { c, processor } = await withVendor();
    const on = aWednesday();
    const first = (await submit(processor, c.caseNo, { collectionOn: on })).body.case as CaseDto;
    const later = addDays(on, 7);
    const res = await submit(processor, c.caseNo, { vendorFileNo: "FR-MUM-88421", collectionOn: later });
    expect(res.status).toBe(200);
    const after = res.body.case as CaseDto;
    expect(after.submission).toMatchObject({ vendorFileNo: "FR-MUM-88421", collectionOn: later, at: first.submission!.at });
    expect(after.dueAt).toBe(istDateTimeToUtc(addDays(later, -1), "11:00").toISOString());

    const change = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.submission.update" } });
    expect(change.before).toMatchObject({ vendorFileNo: "FR-MUM88421", collectionOn: on });
    expect(change.after).toMatchObject({ vendorFileNo: "FR-MUM-88421", collectionOn: later });

    const same = await submit(processor, c.caseNo, { vendorFileNo: "FR-MUM-88421", collectionOn: later });
    expect(same.status).toBe(200);
    expect((same.body.case as CaseDto).updatedAt).toBe(after.updatedAt);
    expect(await prisma.auditLog.count({ where: { action: { in: ["visa.submitted", "visa.submission.update"] } } })).toBe(2);
  });
});

describe("the collection date", () => {
  it("can't be a day the embassy is closed: its own holiday, the country's, all embassies', or a Sunday", async () => {
    const { c, processor } = await withVendor();
    const embassyId = await mumbai();
    const fr = await prisma.country.findUniqueOrThrow({ where: { code: "FR" } });
    const on = aWednesday();
    await closed(on, [{ kind: "EMBASSY", embassyId }]);
    await closed(addDays(on, 1), [{ kind: "COUNTRY", countryId: fr.id }], "French National Day");
    await closed(addDays(on, 2), [{ kind: "ALL_EMBASSIES" }], "Gandhi Jayanti");
    await seedHolidays(prisma);

    const field = async (collectionOn: string) => {
      const res = await submit(processor, c.caseNo, { collectionOn });
      expect(res.status).toBe(400);
      return res.body.issues.collectionOn[0] as string;
    };
    expect(await field(on)).toBe("Dussehra: French embassy, Mumbai is closed that day. Pick another.");
    expect(await field(addDays(on, 1))).toMatch(/^French National Day/);
    expect(await field(addDays(on, 2))).toMatch(/^Gandhi Jayanti/);
    expect(await field(onWeekday(on, 7))).toMatch(/^Weekly off/);
    // A holiday at another post, or only at our office, doesn't block it.
    await closed(addDays(on, 5), [{ kind: "MASTI_OFFICE" }], "Office closed");
    expect((await submit(processor, c.caseNo, { collectionOn: addDays(on, 5) })).status).toBe(200);
  });

  it("waits for the appointment: submitted from its day, and collected after the latest one", async () => {
    const { c, processor } = await withVendor({ held: false });
    const [first, second] = await prisma.visaCaseTraveller.findMany({ where: { caseId: c.id }, orderBy: { position: "asc" } });
    const soon = addDays(istToday(), 2);
    const later = addDays(istToday(), 5);
    await prisma.visaCaseTraveller.update({ where: { id: first!.id }, data: { appointmentAt: istDateTimeToUtc(soon, "10:30") } });
    await prisma.visaCaseTraveller.update({ where: { id: second!.id }, data: { appointmentAt: istDateTimeToUtc(later, "09:00") } });

    // Before the earliest appointment day: not yet.
    const early = await submit(processor, c.caseNo, { collectionOn: aWednesday() });
    expect(early.status).toBe(409);
    expect(early.body.message).toMatch(/^The embassy appointment is \w{3} \d{1,2} \w{3} \d{4}\. Mark it submitted on that day or after\.$/);

    // From the earliest appointment day (today), with a collection after the latest one.
    await prisma.visaCaseTraveller.update({ where: { id: first!.id }, data: { appointmentAt: istDateTimeToUtc(istToday(), "00:00") } });
    for (const collectionOn of [later, addDays(istToday(), 3)]) {
      const res = await submit(processor, c.caseNo, { collectionOn });
      expect(res.status).toBe(400);
      expect(res.body.issues.collectionOn[0]).toMatch(/^Pick a day after the appointment \(/);
    }
    let after = addDays(later, 1);
    while (isoWeekday(after) === 7) after = addDays(after, 1);
    const ok = await submit(processor, c.caseNo, { collectionOn: after });
    expect(ok.status).toBe(200);

    // A change later: the submission stays, but the date still can't move before the latest appointment.
    const moved = await submit(processor, c.caseNo, { collectionOn: later });
    expect(moved.status).toBe(400);
    expect(await prisma.auditLog.count({ where: { action: "visa.submission.update" } })).toBe(0);
  });

  it("has no appointment rule when none is booked", async () => {
    const { c, processor } = await withVendor({ held: false });
    await prisma.visaCaseTraveller.updateMany({ where: { caseId: c.id }, data: { appointmentAt: null } });
    expect((await submit(processor, c.caseNo, { collectionOn: addDays(istToday(), 1) })).status).toBe(200);
  });

  it("is after today and within a year", async () => {
    const { c, processor } = await withVendor();
    for (const collectionOn of [istToday(), addDays(istToday(), -3), addDays(istToday(), 367)]) {
      const res = await submit(processor, c.caseNo, { collectionOn });
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.issues)).toEqual(["collectionOn"]);
    }
  });
});

describe("what is refused", () => {
  it("an embassy of another country or switched off, and a bad file number", async () => {
    const { c, processor } = await withVendor();
    const cn = await prisma.country.findUniqueOrThrow({ where: { code: "CN" } });
    const beijing = await prisma.embassy.create({ data: { code: "CN-MUM", countryId: cn.id, name: "Chinese consulate, Mumbai", city: "Mumbai" } });
    const fr = await prisma.country.findUniqueOrThrow({ where: { code: "FR" } });
    const delhi = await prisma.embassy.create({ data: { code: "FR-DEL", countryId: fr.id, name: "French embassy, Delhi", city: "Delhi", isActive: false } });

    for (const embassyId of [beijing.id, delhi.id]) {
      const res = await submit(processor, c.caseNo, { embassyId });
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.issues)).toEqual(["embassyId"]);
    }
    for (const vendorFileNo of ["", "AB", "-ABC123", "FR.MUM.1", "X".repeat(41)]) {
      const res = await submit(processor, c.caseNo, { vendorFileNo });
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.issues)).toEqual(["vendorFileNo"]);
    }
    expect((await load(processor, c.caseNo)).submission).toBeNull();
  });

  it("keeps an embassy switched off since it was picked, so the date can still move", async () => {
    const { c, processor } = await withVendor();
    expect((await submit(processor, c.caseNo, {})).status).toBe(200);
    await prisma.embassy.update({ where: { code: "FR-MUM" }, data: { isActive: false } });
    expect((await submit(processor, c.caseNo, { collectionOn: addDays(aWednesday(), 7) })).status).toBe(200);
  });

  it("before the vendor got it, at Docket & dispatch, for an e-visa, on a stale page and when postponed", async () => {
    const { c, processor } = await withVendor({ received: false });
    expect((await submit(processor, c.caseNo, {})).body.message).toMatch(/vendor got it first/);

    const waiting = await dispatchCase({ vendorId: c.vendor.id, extra: { mobile: "98250 41235", clientName: "Sunil Shah" } });
    expect((await submit(processor, waiting.caseNo, {})).body.message).toMatch(/with the vendor/);

    const online = await dispatchCase({ vendorId: c.vendor.id, extra: { mobile: "98250 41236", clientName: "Kiran Bhatt" } });
    const { offeringId } = await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: online.id }, select: { offeringId: true } });
    await prisma.visaOffering.update({ where: { id: offeringId }, data: { vendorNeeded: false } });
    await raise(processor, online, "Kiran Bhatt");
    const seen = (await load(processor, online.caseNo)).updatedAt;
    expect((await processor.post(`/api/visa/cases/${online.caseNo}/submit-online`).send({ updatedAt: seen })).status).toBe(200);
    expect((await submit(processor, online.caseNo, {})).body.message).toMatch(/went in online/);
    await prisma.visaOffering.update({ where: { id: offeringId }, data: { vendorNeeded: true } });

    const { updatedAt } = await load(processor, c.caseNo);
    expect((await processor.post(`/api/visa/cases/${c.caseNo}/vendor-received`).send({ updatedAt })).status).toBe(200);
    const fresh = (await load(processor, c.caseNo)).updatedAt;
    expect((await submit(processor, c.caseNo, { updatedAt: "2026-01-01T00:00:00.000Z" })).body.details.code).toBe("STALE");
    await prisma.enquiry.update({
      where: { id: c.id },
      data: { status: "POSTPONED", reasonId: await reason("TRAVEL_DATES_MOVED"), resumeOn: toDbDate(addMonths(istToday(), 1)) },
    });
    expect((await submit(processor, c.caseNo, { updatedAt: fresh })).body.message).toMatch(/postponed/);
    expect(await prisma.auditLog.count({ where: { action: "visa.submitted" } })).toBe(0);
  });

  it("the database keeps the five together, only after the vendor got it", async () => {
    const { c } = await withVendor({ received: false });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "neha@masti.test" } });
    const all = { vendorFileNo: "FR-1", embassyId: await mumbai(), collectionOn: toDbDate(aWednesday()), submittedAt: new Date(), submittedById: user.id };
    await expect(prisma.visaCase.update({ where: { enquiryId: c.id }, data: all })).rejects.toThrow(/VisaCase_submitted_after_received/);
    await prisma.visaCase.update({ where: { enquiryId: c.id }, data: { vendorReceivedAt: new Date(), vendorReceivedById: user.id } });
    await expect(prisma.visaCase.update({ where: { enquiryId: c.id }, data: { vendorFileNo: "FR-1" } })).rejects.toThrow(/VisaCase_submission_together/);
    await expect(prisma.visaCase.update({ where: { enquiryId: c.id }, data: { ...all, vendorFileNo: "fr 1" } })).rejects.toThrow(/VisaCase_vendor_file_no_format/);
  });
});

describe("who may save it", () => {
  it("its processor, the Visa HOD and the Head; not other staff, view-only users or other departments", async () => {
    const { c } = await withVendor();
    await createUser({ name: "Kiran", email: "kiran@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
    await createUser({ name: "Hetal", email: "hetal@masti.test", departments: [{ code: "HOLIDAYS", access: "EDIT" }] });
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const seen = (await load(await neha(), c.caseNo)).updatedAt;

    for (const email of ["kiran@masti.test", "meena@masti.test", "hetal@masti.test"]) {
      expect((await submit(await loginAs(email), c.caseNo, { updatedAt: seen })).status).toBe(403);
    }
    const hod = await submit(await loginAs("riya@masti.test"), c.caseNo, { updatedAt: seen });
    expect(hod.status).toBe(200);
    expect((hod.body.case as CaseDto).submission!.by!.name).toBe("Riya");
    expect((await submit(await loginAs("vimal@masti.test"), c.caseNo, { collectionOn: addDays(aWednesday(), 7) })).status).toBe(200);
  });
});

describe("races", () => {
  it("a save that waited behind a postpone sees it and is refused", async () => {
    const { c, processor } = await withVendor();
    const seen = (await load(processor, c.caseNo)).updatedAt;
    const reasonId = await reason("TRAVEL_DATES_MOVED");
    const embassyId = await mumbai();

    const postpone = holdCaseLock(c.id, (tx) =>
      tx.enquiry.update({ where: { id: c.id }, data: { status: "POSTPONED", reasonId, resumeOn: toDbDate(addMonths(istToday(), 1)) } }),
    );
    await postpone.ready;
    const pending = submit(processor, c.caseNo, { embassyId, updatedAt: seen }).then((r) => r);
    try {
      await untilWaitingOnLock();
    } finally {
      postpone.release();
    }
    await postpone.done;
    const res = await pending;
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/postponed/);
    expect((await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: c.id } })).submittedAt).toBeNull();
  });
});

describe("previousOpenDay", () => {
  it("walks back over blocked days to the last open one", async () => {
    const day = aWednesday();
    await closed(day, [{ kind: "MASTI_OFFICE" }], "Office closed");
    await closed(addDays(day, -1), [{ kind: "MASTI_OFFICE" }], "Office closed");
    expect(await previousOpenDay(day, { office: true })).toBe(addDays(day, -2));
    expect(await previousOpenDay(addDays(day, 1), { office: true })).toBe(addDays(day, 1));
  });
});
