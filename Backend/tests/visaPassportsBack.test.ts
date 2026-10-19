import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays, addMonths, isoWeekday, istDateTimeToUtc, istToday, toDbDate } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { nextOpenDay } from "../src/modules/holidays/blockedDays";
import { seedHolidays } from "../src/modules/holidays/holidays.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { decidedCase, dispatchCase, holdCaseLock, makeInvoiceable, mastiReady, recalledCase, untilWaitingOnLock, type Agent } from "./visaHelpers";

// Visa Step 7, passports on the way back (docs/decisions/0013-visa-passport-back.md Decision 3): the day the vendor
// collected them and the day they're expected at our office, an open office day. The case moves to Passport back, in
// transit, due that day at 11:00 ⚠️ (visa.arrivalCheck). A recalled file does the same at Passport back; an e-visa,
// whose passports never left, doesn't (Decision 4). While they're in transit, "Change" corrects either day (component 2).
// "Mark received" puts them in our stock, with the booklets counted and the stickers checked (Decision 5, component 3).

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

interface CaseDto {
  updatedAt: string;
  dueAt: string | null;
  status: string;
  stage: { code: string };
  recall: { reason: string } | null;
  decision: { at: string } | null;
  passportsBack: { collectedOn: string; expectedOn: string; at: string; by: { name: string } | null } | null;
  passportsReceived: { at: string; by: { name: string } | null; booklets: { current: number; old: number } } | null;
  travellers: { id: string; decision: { outcome: string } | null; stickerCheck: string | null }[];
}
type Body = { collectedOn?: string; expectedOn?: string; updatedAt?: string };

const load = async (agent: Agent, caseNo: string) => (await agent.get(`/api/visa/cases/${caseNo}`)).body.case as CaseDto;
const reason = async (code: string) => (await prisma.enquiryReason.findUniqueOrThrow({ where: { code } })).id;
/** Two days out, or the first day after that our office is open. */
const anOpenDay = () => nextOpenDay(addDays(istToday(), 2), { office: true });
/** The next Sunday after today. */
function nextSunday() {
  let day = addDays(istToday(), 1);
  while (isoWeekday(day) !== 7) day = addDays(day, 1);
  return day;
}

/** "Passports on the way back": collected today and expected on an open day, unless `body` says otherwise. */
async function send(agent: Agent, caseNo: string, body: Body = {}) {
  // Read first: a request awaited inside another's .send(...) breaks supertest.
  const updatedAt = body.updatedAt ?? (await load(agent, caseNo)).updatedAt;
  const expectedOn = body.expectedOn ?? (await anOpenDay());
  return agent.post(`/api/visa/cases/${caseNo}/passports-back`).send({ collectedOn: istToday(), ...body, expectedOn, updatedAt });
}

/** An e-visa (Vendor needed off), Neha's, invoiced, "Submitted online" and decided (both refused): at Decision. */
async function eVisaDecided() {
  if (!(await prisma.user.findUnique({ where: { email: "vimal@masti.test" } }))) await mastiReady();
  // Another file may already have made the vendor: readyCase would add it again otherwise.
  const vendorId = (await prisma.vendor.findFirst())?.id;
  const c = await dispatchCase({ ...(vendorId ? { vendorId } : {}), extra: { mobile: "98250 41299", clientName: "Asha Desai" } });
  const { offeringId } = await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: c.id }, select: { offeringId: true } });
  await prisma.visaOffering.update({ where: { id: offeringId }, data: { vendorNeeded: false } });
  await prisma.visaCase.update({ where: { enquiryId: c.id }, data: { vendorId: null } });
  const processor = await loginAs("neha@masti.test");
  const { travellers } = await makeInvoiceable(processor, c, { clientName: "Asha Desai" });
  const { quoteUpdatedAt, taxType, gstRatePercent, totalPaise } = (await processor.get(`/api/visa/cases/${c.caseNo}/invoice/check`)).body.preview;
  expect((await processor.post(`/api/visa/cases/${c.caseNo}/invoice`).send({ quoteUpdatedAt, taxType, gstRatePercent, totalPaise })).status).toBe(200);
  const seen = (await load(processor, c.caseNo)).updatedAt;
  expect((await processor.post(`/api/visa/cases/${c.caseNo}/submit-online`).send({ updatedAt: seen })).status).toBe(200);
  const outcomes = travellers.map((t) => ({ travellerId: t.id, outcome: "REFUSED" }));
  const decidedAt = (await load(processor, c.caseNo)).updatedAt;
  expect((await processor.post(`/api/visa/cases/${c.caseNo}/decision`).send({ outcomes, updatedAt: decidedAt })).status).toBe(200);
  return { c, processor };
}

describe("passports on the way back (Decision 3)", () => {
  it("moves a decided case to Passport back, in transit, due on the expected day at 11:00, audited", async () => {
    const { c, processor } = await decidedCase();
    const expectedOn = await anOpenDay();
    const res = await send(processor, c.caseNo, { expectedOn });
    expect(res.status).toBe(200);
    const after = res.body.case as CaseDto;
    expect(after.stage.code).toBe("PASSPORT_BACK");
    expect(after.passportsBack).toMatchObject({ collectedOn: istToday(), expectedOn, by: { name: "Neha Joshi" } });
    expect(after.dueAt).toBe(istDateTimeToUtc(expectedOn, "11:00").toISOString());

    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.passports.inTransit" } });
    expect(row).toMatchObject({ entityType: "Enquiry", entityId: c.id, clientId: c.client.id });
    expect(row.before).toMatchObject({ stage: "DECISION" });
    expect(row.after).toMatchObject({ stage: "PASSPORT_BACK", collectedOn: istToday(), expectedOn, dueAt: after.dueAt });
  });

  it("the due time follows visa.arrivalCheck, on an open office day", async () => {
    const { c, processor } = await decidedCase();
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    expect((await (await loginAs("riya@masti.test")).put("/api/visa/settings").send({ arrivalCheck: { afterDays: 1, at: "10:00" } })).status).toBe(200);
    await seedHolidays(prisma); // the weekly Sunday off
    const expectedOn = await anOpenDay();
    const res = await send(processor, c.caseNo, { expectedOn });
    expect(res.status).toBe(200);
    const due = await nextOpenDay(addDays(expectedOn, 1), { office: true });
    expect((res.body.case as CaseDto).dueAt).toBe(istDateTimeToUtc(due, "10:00").toISOString());
  });

  it("a recalled file does the same at Passport back, still with no decision", async () => {
    const { c, processor } = await recalledCase();
    const before = await load(processor, c.caseNo);
    expect(before).toMatchObject({ stage: { code: "PASSPORT_BACK" }, recall: { reason: "Embassy taking too long" }, passportsBack: null });
    const expectedOn = await anOpenDay();
    const res = await send(processor, c.caseNo, { expectedOn });
    expect(res.status).toBe(200);
    const after = res.body.case as CaseDto;
    expect(after).toMatchObject({ stage: { code: "PASSPORT_BACK" }, decision: null, passportsBack: { expectedOn } });
    expect(after.dueAt).toBe(istDateTimeToUtc(expectedOn, "11:00").toISOString());
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.passports.inTransit" } })).before).toMatchObject({ stage: "PASSPORT_BACK" });
  });
});

describe("what is refused", () => {
  it("the collected day: after today, or before the file was dispatched", async () => {
    const { c, processor } = await decidedCase();
    const issue = async (collectedOn: string) => {
      const res = await send(processor, c.caseNo, { collectedOn });
      expect(res.status).toBe(400);
      return res.body.issues.collectedOn as string[];
    };
    expect(await issue(addDays(istToday(), 1))).toEqual(["Pick today or an earlier day."]);
    // The fixture dispatched the file today.
    expect(await issue(addDays(istToday(), -1))).toEqual(["Pick a day on or after the file was dispatched."]);
    expect((await send(processor, c.caseNo, { collectedOn: "not a day" })).body.issues.collectedOn).toEqual(["Pick the day the vendor collected the passports."]);
  });

  it("the expected day: before today, more than a year ahead, a Sunday or an office holiday", async () => {
    const { c, processor } = await decidedCase();
    await seedHolidays(prisma); // the weekly Sunday off
    const holiday = await anOpenDay();
    await prisma.holiday.create({
      data: { name: "Diwali office closure", repeat: "NONE", startDate: toDbDate(holiday), endDate: toDbDate(holiday), targets: { create: [{ kind: "MASTI_OFFICE" }] } },
    });
    const issue = async (expectedOn: string) => {
      const res = await send(processor, c.caseNo, { expectedOn });
      expect(res.status).toBe(400);
      return res.body.issues.expectedOn as string[];
    };
    expect(await issue(addDays(istToday(), -1))).toEqual(["Pick today or a later day."]);
    expect(await issue(addDays(istToday(), 400))).toEqual(["Pick a day within the next year."]);
    expect(await issue(nextSunday())).toEqual(["Weekly off: our office is closed that day. Pick another."]);
    expect(await issue(holiday)).toEqual(["Diwali office closure: our office is closed that day. Pick another."]);
    expect((await load(processor, c.caseNo)).stage.code).toBe("DECISION");
    expect(await prisma.auditLog.count({ where: { action: "visa.passports.inTransit" } })).toBe(0);
  });

  it("before the decision, twice, on a stale page and when postponed", async () => {
    const { c, processor } = await decidedCase({ decided: false });
    const early = await send(processor, c.caseNo);
    expect(early.status).toBe(409);
    expect(early.body.message).toBe("Passports go back after the decision, or after a recall.");

    const done = await decidedCase({ extra: { mobile: "98250 41236", clientName: "Kiran Bhatt" }, vendorId: c.vendor.id });
    expect((await send(processor, done.c.caseNo)).status).toBe(200);
    const again = await send(processor, done.c.caseNo);
    expect(again.status).toBe(409);
    expect(again.body.message).toBe("The passports are already on their way back.");

    const other = await decidedCase({ extra: { mobile: "98250 41237", clientName: "Sunil Shah" }, vendorId: c.vendor.id });
    const fresh = (await load(processor, other.c.caseNo)).updatedAt;
    expect((await send(processor, other.c.caseNo, { updatedAt: "2026-01-01T00:00:00.000Z" })).body.details.code).toBe("STALE");
    await prisma.enquiry.update({
      where: { id: other.c.id },
      data: { status: "POSTPONED", reasonId: await reason("TRAVEL_DATES_MOVED"), resumeOn: toDbDate(addMonths(istToday(), 1)) },
    });
    expect((await send(processor, other.c.caseNo, { updatedAt: fresh })).body.message).toMatch(/postponed/);
    expect(await prisma.auditLog.count({ where: { action: "visa.passports.inTransit" } })).toBe(1);
  });

  it("an e-visa: its passports never left the office (Decision 4)", async () => {
    const { c, processor } = await eVisaDecided();
    const res = await send(processor, c.caseNo);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("An e-visa's passports never left the office.");
    expect((await load(processor, c.caseNo)).stage.code).toBe("DECISION");
  });
});

describe("who may send them back", () => {
  it("its processor, the Visa HOD and the Head; not other staff, view-only users or other departments", async () => {
    const { c, processor } = await decidedCase();
    await createUser({ name: "Kiran", email: "kiran@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
    await createUser({ name: "Hetal", email: "hetal@masti.test", departments: [{ code: "HOLIDAYS", access: "EDIT" }] });
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const seen = (await load(processor, c.caseNo)).updatedAt;
    for (const email of ["kiran@masti.test", "meena@masti.test", "hetal@masti.test"]) {
      expect((await send(await loginAs(email), c.caseNo, { updatedAt: seen })).status).toBe(403);
    }
    const hod = await send(await loginAs("riya@masti.test"), c.caseNo, { updatedAt: seen });
    expect(hod.status).toBe(200);
    expect((hod.body.case as CaseDto).passportsBack!.by!.name).toBe("Riya");

    const other = await decidedCase({ extra: { mobile: "98250 41237", clientName: "Sunil Shah" }, vendorId: c.vendor.id });
    expect((await send(await loginAs("vimal@masti.test"), other.c.caseNo)).status).toBe(200);
  });
});

describe("the database", () => {
  it("keeps the two days, who and when together and in order, only after a decision or recall, never for an e-visa", async () => {
    const { c } = await decidedCase({ decided: false });
    const neha = await prisma.user.findUniqueOrThrow({ where: { email: "neha@masti.test" } });
    const today = istToday();
    const inTransit = { passportsCollectedOn: toDbDate(today), passportsExpectedOn: toDbDate(addDays(today, 2)), passportsInTransitAt: new Date(), passportsInTransitById: neha.id };
    const set = (enquiryId: string, data: Record<string, unknown>) => prisma.visaCase.update({ where: { enquiryId }, data });
    // Not decided yet.
    await expect(set(c.id, inTransit)).rejects.toThrow(/VisaCase_in_transit_after_decision/);

    const decided = await decidedCase({ extra: { mobile: "98250 41236", clientName: "Kiran Bhatt" }, vendorId: c.vendor.id });
    const { passportsInTransitById: _by, ...withoutWho } = inTransit;
    await expect(set(decided.c.id, withoutWho)).rejects.toThrow(/VisaCase_in_transit_together/);
    await expect(set(decided.c.id, { ...inTransit, passportsExpectedOn: toDbDate(addDays(today, -1)) })).rejects.toThrow(/VisaCase_in_transit_dates/);
    await expect(set(decided.c.id, { ...inTransit, passportsCollectedOn: toDbDate(addDays(today, 1)) })).rejects.toThrow(/VisaCase_in_transit_dates/);
    await set(decided.c.id, inTransit);

    const online = await eVisaDecided();
    await expect(set(online.c.id, inTransit)).rejects.toThrow(/VisaCase_in_transit_not_online/);
  });
});

describe("races", () => {
  it("waits for a send already in flight, then refuses the second", async () => {
    const { c, processor } = await decidedCase();
    const neha = await prisma.user.findUniqueOrThrow({ where: { email: "neha@masti.test" } });
    const today = istToday();
    const first = holdCaseLock(c.id, (tx) =>
      tx.visaCase.update({
        where: { enquiryId: c.id },
        data: { passportsCollectedOn: toDbDate(today), passportsExpectedOn: toDbDate(addDays(today, 2)), passportsInTransitAt: new Date(), passportsInTransitById: neha.id },
      }),
    );
    await first.ready;
    const pending = send(processor, c.caseNo).then((r) => r);
    try {
      await untilWaitingOnLock();
    } finally {
      first.release();
    }
    await first.done;
    const res = await pending;
    expect(res.status).toBe(409);
    expect(res.body.message).toBe("The passports are already on their way back.");
    expect(await prisma.auditLog.count({ where: { action: "visa.passports.inTransit" } })).toBe(0);
  });
});

describe("once the passports are on their way back", () => {
  it("the decision can't be changed, and a refusal letter can still be added", async () => {
    const { c, processor, adult, child } = await decidedCase();
    expect((await send(processor, c.caseNo)).status).toBe(200);
    const { updatedAt } = await prisma.enquiry.findUniqueOrThrow({ where: { id: c.id }, select: { updatedAt: true } });
    const change = await processor.put(`/api/visa/cases/${c.caseNo}/travellers/${adult}/decision`).send({ outcome: "REFUSED", updatedAt });
    expect(change.status).toBe(409);
    expect(change.body.message).toBe("The decision can only be changed while the case is at Decision.");

    const doc = await PDFDocument.create();
    doc.addPage();
    const letter = await processor
      .post(`/api/visa/cases/${c.caseNo}/travellers/${child}/refusal-letter`)
      .set("Content-Type", "application/pdf")
      .send(Buffer.from(await doc.save()));
    expect(letter.status).toBe(200);
  });
});

describe("Change the dates (component 2)", () => {
  /** "Change" on the card: the dates the page shows, with `body` over them. */
  async function change(agent: Agent, caseNo: string, body: Body = {}) {
    const c = await load(agent, caseNo);
    const dates = { collectedOn: c.passportsBack?.collectedOn ?? istToday(), expectedOn: c.passportsBack?.expectedOn ?? (await anOpenDay()) };
    return agent.put(`/api/visa/cases/${caseNo}/passports-back`).send({ ...dates, updatedAt: c.updatedAt, ...body });
  }

  it("moves the expected day: the due time follows, the step and who first recorded it stay, audited", async () => {
    const { c, processor } = await decidedCase();
    expect((await send(processor, c.caseNo)).status).toBe(200);
    const before = await load(processor, c.caseNo);
    const later = await nextOpenDay(addDays(before.passportsBack!.expectedOn, 3), { office: true });
    const res = await change(processor, c.caseNo, { expectedOn: later });
    expect(res.status).toBe(200);
    const after = res.body.case as CaseDto;
    expect(after.stage.code).toBe("PASSPORT_BACK");
    expect(after.passportsBack).toEqual({ ...before.passportsBack, expectedOn: later });
    expect(after.dueAt).toBe(istDateTimeToUtc(later, "11:00").toISOString());

    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.passports.update" } });
    expect(row).toMatchObject({ entityType: "Enquiry", entityId: c.id });
    expect(row.before).toMatchObject({ collectedOn: istToday(), expectedOn: before.passportsBack!.expectedOn, dueAt: before.dueAt });
    expect(row.after).toMatchObject({ collectedOn: istToday(), expectedOn: later, dueAt: after.dueAt });
  });

  it("corrects the collected day: not before the dispatch, nor after the day they were recorded on the way back", async () => {
    const { c, processor } = await decidedCase();
    // The file went to the vendor five days ago.
    const { docketId } = await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: c.id }, select: { docketId: true } });
    await prisma.docket.update({ where: { id: docketId! }, data: { dispatchedAt: new Date(Date.now() - 5 * 86_400_000) } });
    expect((await send(processor, c.caseNo, { collectedOn: addDays(istToday(), -2) })).status).toBe(200);

    const res = await change(processor, c.caseNo, { collectedOn: addDays(istToday(), -3) });
    expect(res.status).toBe(200);
    expect((res.body.case as CaseDto).passportsBack!.collectedOn).toBe(addDays(istToday(), -3));
    expect((await change(processor, c.caseNo, { collectedOn: addDays(istToday(), -6) })).body.issues.collectedOn).toEqual([
      "Pick a day on or after the file was dispatched.",
    ]);

    // Recorded on the way back yesterday: the vendor had them by then.
    const yesterday = addDays(istToday(), -1);
    await prisma.visaCase.update({
      where: { enquiryId: c.id },
      data: { passportsCollectedOn: toDbDate(yesterday), passportsInTransitAt: istDateTimeToUtc(yesterday, "15:00") },
    });
    const late = await change(processor, c.caseNo, { collectedOn: istToday() });
    expect(late.status).toBe(400);
    expect(late.body.issues.collectedOn).toEqual(["Pick a day on or before the day they were recorded on the way back."]);
    expect(await prisma.auditLog.count({ where: { action: "visa.passports.update" } })).toBe(1);
  });

  it("a save that changes nothing writes nothing", async () => {
    const { c, processor } = await decidedCase();
    expect((await send(processor, c.caseNo)).status).toBe(200);
    const before = await load(processor, c.caseNo);
    const res = await change(processor, c.caseNo);
    expect(res.status).toBe(200);
    expect((res.body.case as CaseDto).updatedAt).toBe(before.updatedAt);
    expect(await prisma.auditLog.count({ where: { action: "visa.passports.update" } })).toBe(0);
  });

  it("before they're on the way back, at another step, on a closed or past day, on a stale page and when postponed", async () => {
    await seedHolidays(prisma); // the weekly Sunday off
    const { c, processor } = await recalledCase();
    const early = await change(processor, c.caseNo);
    expect(early.status).toBe(409);
    expect(early.body.message).toBe("Mark the passports on the way back first.");

    const decided = await decidedCase({ extra: { mobile: "98250 41236", clientName: "Kiran Bhatt" }, vendorId: c.vendor.id });
    const atDecision = await change(processor, decided.c.caseNo);
    expect(atDecision.status).toBe(409);
    expect(atDecision.body.message).toBe("The dates can only be changed while the passports are on their way back.");

    expect((await send(processor, decided.c.caseNo)).status).toBe(200);
    expect((await change(processor, decided.c.caseNo, { expectedOn: nextSunday() })).body.issues.expectedOn).toEqual([
      "Weekly off: our office is closed that day. Pick another.",
    ]);
    expect((await change(processor, decided.c.caseNo, { expectedOn: addDays(istToday(), -1) })).body.issues.expectedOn).toEqual([
      "Pick today or a later day.",
    ]);
    const later = await nextOpenDay(addDays(istToday(), 9), { office: true });
    expect((await change(processor, decided.c.caseNo, { expectedOn: later, updatedAt: "2026-01-01T00:00:00.000Z" })).body.details.code).toBe("STALE");
    const fresh = (await load(processor, decided.c.caseNo)).updatedAt;
    await prisma.enquiry.update({
      where: { id: decided.c.id },
      data: { status: "POSTPONED", reasonId: await reason("TRAVEL_DATES_MOVED"), resumeOn: toDbDate(addMonths(istToday(), 1)) },
    });
    expect((await change(processor, decided.c.caseNo, { expectedOn: later, updatedAt: fresh })).body.message).toMatch(/postponed/);
    expect(await prisma.auditLog.count({ where: { action: "visa.passports.update" } })).toBe(0);
  });

  it("its processor, the Visa HOD and the Head; not other staff", async () => {
    const { c, processor } = await decidedCase();
    expect((await send(processor, c.caseNo)).status).toBe(200);
    await createUser({ name: "Kiran", email: "kiran@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const seen = await load(processor, c.caseNo);
    const later = await nextOpenDay(addDays(seen.passportsBack!.expectedOn, 2), { office: true });
    const body = { collectedOn: seen.passportsBack!.collectedOn, expectedOn: later, updatedAt: seen.updatedAt };
    const put = (agent: Agent) => agent.put(`/api/visa/cases/${c.caseNo}/passports-back`).send(body);
    expect((await put(await loginAs("kiran@masti.test"))).status).toBe(403);
    const hod = await put(await loginAs("riya@masti.test"));
    expect(hod.status).toBe(200);
    // Who recorded them on the way back stays.
    expect((hod.body.case as CaseDto).passportsBack).toMatchObject({ expectedOn: later, by: { name: "Neha Joshi" } });
    const audited = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.passports.update" }, include: { actor: { select: { name: true } } } });
    expect(audited.actor?.name).toBe("Riya");
  });
});

describe("Mark received (component 3)", () => {
  type Receipt = { booklets?: { current: number; old: number }; stickers?: { travellerId: string; check: string }[]; updatedAt?: string };
  /** "Mark received": as counted (2 current, 0 old, what went to the vendor), every approved sticker matching, unless `body` says otherwise. */
  async function receive(agent: Agent, caseNo: string, body: Receipt = {}) {
    const c = await load(agent, caseNo);
    const stickers = c.travellers.filter((t) => t.decision?.outcome === "APPROVED").map((t) => ({ travellerId: t.id, check: "MATCHES" }));
    return agent.post(`/api/visa/cases/${caseNo}/passports-received`).send({ booklets: { current: 2, old: 0 }, stickers, updatedAt: c.updatedAt, ...body });
  }
  const received = () => prisma.auditLog.findFirstOrThrow({ where: { action: "visa.passports.received" } });

  it("puts them in our stock: who and when, the booklets, the approved sticker; due to arrange the handover; audited", async () => {
    const { c, processor } = await decidedCase();
    expect((await send(processor, c.caseNo)).status).toBe(200);
    const res = await receive(processor, c.caseNo);
    expect(res.status).toBe(200);
    const after = res.body.case as CaseDto;
    expect(after.stage.code).toBe("PASSPORT_BACK");
    expect(after.passportsReceived).toMatchObject({ by: { name: "Neha Joshi" }, booklets: { current: 2, old: 0 } });
    // Rakesh approved (checked), Aarav refused (no sticker).
    expect(after.travellers.map((t) => t.stickerCheck)).toEqual(["MATCHES", null]);
    expect(after.dueAt).toBe(istDateTimeToUtc(await nextOpenDay(addDays(istToday(), 1), { office: true }), "11:00").toISOString());

    const row = await received();
    expect(row).toMatchObject({ entityType: "Enquiry", entityId: c.id, clientId: c.client.id });
    expect(row.after).toMatchObject({
      booklets: { current: 2, old: 0 },
      intake: { current: 2, old: 0 },
      matchesIntake: true,
      stickers: [{ name: "Rakesh Mehta", check: "MATCHES" }],
      dueAt: after.dueAt,
    });
  });

  it("a short count and a sticker that doesn't match are recorded, not refused; the due time follows visa.handoverCheck", async () => {
    const { c, processor, adult } = await decidedCase();
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    expect((await (await loginAs("riya@masti.test")).put("/api/visa/settings").send({ handoverCheck: { afterDays: 2, at: "10:00" } })).status).toBe(200);
    expect((await send(processor, c.caseNo)).status).toBe(200);
    const res = await receive(processor, c.caseNo, { booklets: { current: 1, old: 0 }, stickers: [{ travellerId: adult, check: "MISMATCH" }] });
    expect(res.status).toBe(200);
    const after = res.body.case as CaseDto;
    expect(after.passportsReceived!.booklets).toEqual({ current: 1, old: 0 });
    expect(after.travellers[0]!.stickerCheck).toBe("MISMATCH");
    expect(after.dueAt).toBe(istDateTimeToUtc(await nextOpenDay(addDays(istToday(), 2), { office: true }), "10:00").toISOString());
    expect((await received()).after).toMatchObject({ intake: { current: 2, old: 0 }, matchesIntake: false, stickers: [{ name: "Rakesh Mehta", check: "MISMATCH" }] });
  });

  it("a recalled file has no stickers: booklets only", async () => {
    const { c, processor } = await recalledCase();
    expect((await send(processor, c.caseNo)).status).toBe(200);
    const [first] = (await load(processor, c.caseNo)).travellers;
    const listed = await receive(processor, c.caseNo, { stickers: [{ travellerId: first!.id, check: "MATCHES" }] });
    expect(listed.status).toBe(400);
    expect(listed.body.issues.stickers).toEqual(["Rakesh Mehta has no visa: there's no sticker to check."]);
    const res = await receive(processor, c.caseNo, { stickers: [] });
    expect(res.status).toBe(200);
    expect((res.body.case as CaseDto).passportsReceived).toMatchObject({ booklets: { current: 2, old: 0 } });
  });

  it("a postponed or cancelled case is received too, keeping its status; a cancelled one is due for the handover", async () => {
    const { c, processor } = await decidedCase();
    expect((await send(processor, c.caseNo)).status).toBe(200);
    await prisma.enquiry.update({
      where: { id: c.id },
      data: { status: "POSTPONED", reasonId: await reason("TRAVEL_DATES_MOVED"), resumeOn: toDbDate(addMonths(istToday(), 1)) },
    });
    const before = await load(processor, c.caseNo);
    const res = await receive(processor, c.caseNo);
    expect(res.status).toBe(200);
    expect(res.body.case as CaseDto).toMatchObject({ status: "POSTPONED", dueAt: before.dueAt, passportsReceived: { booklets: { current: 2, old: 0 } } });

    const other = await decidedCase({ extra: { mobile: "98250 41236", clientName: "Kiran Bhatt" }, vendorId: c.vendor.id });
    expect((await send(processor, other.c.caseNo)).status).toBe(200);
    await prisma.enquiry.update({ where: { id: other.c.id }, data: { status: "CANCELLED", reasonId: await reason("TRIP_CANCELLED"), resumeOn: null, dueAt: null } });
    const cancelled = await receive(processor, other.c.caseNo);
    expect(cancelled.status).toBe(200);
    // It stays on its owner's list until the handover (0006 amendment 15): due like an open case (visa.handoverCheck).
    const handoverDue = istDateTimeToUtc(await nextOpenDay(addDays(istToday(), 1), { office: true }), "11:00").toISOString();
    expect(cancelled.body.case as CaseDto).toMatchObject({ status: "CANCELLED", dueAt: handoverDue });
  });

  it("before they're on the way back, at another step, the wrong stickers or booklets, a stale page, and twice", async () => {
    const { c, processor, adult, child } = await decidedCase();
    const atDecision = await receive(processor, c.caseNo);
    expect(atDecision.status).toBe(409);
    expect(atDecision.body.message).toBe("Passports are received at Passport back.");
    const recalled = await recalledCase({ extra: { mobile: "98250 41237", clientName: "Sunil Shah" }, vendorId: c.vendor.id });
    const notSent = await receive(processor, recalled.c.caseNo, { stickers: [] });
    expect(notSent.status).toBe(409);
    expect(notSent.body.message).toBe("Mark the passports on the way back first.");

    expect((await send(processor, c.caseNo)).status).toBe(200);
    const issue = async (body: Receipt, field: "stickers" | "booklets") => {
      const res = await receive(processor, c.caseNo, body);
      expect(res.status).toBe(400);
      return res.body.issues[field] as string[];
    };
    expect(await issue({ stickers: [] }, "stickers")).toEqual(["Check Rakesh Mehta's sticker."]);
    expect(await issue({ stickers: [{ travellerId: adult, check: "MATCHES" }, { travellerId: child, check: "MATCHES" }] }, "stickers")).toEqual([
      "Aarav Mehta was refused: there's no sticker to check.",
    ]);
    expect(await issue({ stickers: [{ travellerId: adult, check: "MATCHES" }, { travellerId: adult, check: "MATCHES" }] }, "stickers")).toEqual([
      "Rakesh Mehta is on the list twice.",
    ]);
    expect(await issue({ stickers: [{ travellerId: "not-a-traveller", check: "MATCHES" }] }, "stickers")).toEqual([
      "Someone on this list isn't on the case. Reload and try again.",
    ]);
    expect(await issue({ stickers: [{ travellerId: adult, check: "MAYBE" }] }, "stickers")).toEqual(["Pick Matches or Doesn't match."]);
    expect(await issue({ booklets: { current: 0, old: 0 } }, "booklets")).toEqual(["Count at least one booklet."]);
    expect(await issue({ booklets: { current: 51, old: 0 } }, "booklets")).toEqual(["50 at most."]);
    expect((await receive(processor, c.caseNo, { updatedAt: "2026-01-01T00:00:00.000Z" })).body.details.code).toBe("STALE");
    expect(await prisma.auditLog.count({ where: { action: "visa.passports.received" } })).toBe(0);

    expect((await receive(processor, c.caseNo)).status).toBe(200);
    const twice = await receive(processor, c.caseNo);
    expect(twice.status).toBe(409);
    expect(twice.body.message).toBe("The passports are already in our stock.");
    expect(await prisma.auditLog.count({ where: { action: "visa.passports.received" } })).toBe(1);
  });

  it("its processor, the Visa HOD and the Head; not other staff", async () => {
    const { c, processor, adult } = await decidedCase();
    expect((await send(processor, c.caseNo)).status).toBe(200);
    await createUser({ name: "Kiran", email: "kiran@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const { updatedAt } = await load(processor, c.caseNo);
    const body = { booklets: { current: 2, old: 0 }, stickers: [{ travellerId: adult, check: "MATCHES" }], updatedAt };
    const post = (agent: Agent) => agent.post(`/api/visa/cases/${c.caseNo}/passports-received`).send(body);
    expect((await post(await loginAs("kiran@masti.test"))).status).toBe(403);
    const hod = await post(await loginAs("riya@masti.test"));
    expect(hod.status).toBe(200);
    expect((hod.body.case as CaseDto).passportsReceived!.by!.name).toBe("Riya");
  });

  it("once received, the dates can't change, and a refusal letter can still be added", async () => {
    const { c, processor, child } = await decidedCase();
    expect((await send(processor, c.caseNo)).status).toBe(200);
    expect((await receive(processor, c.caseNo)).status).toBe(200);
    const seen = await load(processor, c.caseNo);
    const later = await nextOpenDay(addDays(seen.passportsBack!.expectedOn, 2), { office: true });
    const change = await processor
      .put(`/api/visa/cases/${c.caseNo}/passports-back`)
      .send({ collectedOn: seen.passportsBack!.collectedOn, expectedOn: later, updatedAt: seen.updatedAt });
    expect(change.status).toBe(409);
    expect(change.body.message).toBe("The passports are already in our stock.");

    const doc = await PDFDocument.create();
    doc.addPage();
    const letter = await processor
      .post(`/api/visa/cases/${c.caseNo}/travellers/${child}/refusal-letter`)
      .set("Content-Type", "application/pdf")
      .send(Buffer.from(await doc.save()));
    expect(letter.status).toBe(200);
  });

  it("the database keeps who, when and the counts together, after the transit, in range, and stickers for the approved only", async () => {
    const { c, processor, adult, child } = await decidedCase();
    const neha = await prisma.user.findUniqueOrThrow({ where: { email: "neha@masti.test" } });
    const set = (data: Record<string, unknown>) => prisma.visaCase.update({ where: { enquiryId: c.id }, data });
    const stock = { passportsReceivedAt: new Date(), passportsReceivedById: neha.id, bookletsBackCurrent: 2, bookletsBackOld: 0 };
    // Not on its way back yet.
    await expect(set(stock)).rejects.toThrow(/VisaCase_received_after_transit/);

    expect((await send(processor, c.caseNo)).status).toBe(200);
    const now = { ...stock, passportsReceivedAt: new Date() };
    await expect(set({ ...now, bookletsBackOld: null })).rejects.toThrow(/VisaCase_received_together/);
    await expect(set({ ...now, bookletsBackCurrent: 0 })).rejects.toThrow(/VisaCase_booklets_back_range/);
    await expect(set({ ...now, bookletsBackCurrent: 51 })).rejects.toThrow(/VisaCase_booklets_back_range/);
    await expect(set({ ...now, passportsReceivedAt: new Date(Date.now() - 86_400_000) })).rejects.toThrow(/VisaCase_received_after_transit/);
    await set(now);

    const sticker = (id: string, stickerCheck: "MATCHES" | "MISMATCH") => prisma.visaCaseTraveller.update({ where: { id }, data: { stickerCheck } });
    await expect(sticker(child, "MATCHES")).rejects.toThrow(/VisaCaseTraveller_sticker_check_approved/);
    await sticker(adult, "MISMATCH");
  });
});
