import { beforeEach, describe, expect, it } from "vitest";
import { addDays, addMonths, isoWeekday, istDateTimeToUtc, istToday, toDbDate } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { nextOpenDay } from "../src/modules/holidays/blockedDays";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { appointmentsHeld, dispatchCase, makeInvoiceable, mastiReady, type Agent } from "./visaHelpers";

// Visa Step 6, the decision (docs/decisions/0012-visa-decision.md): once the file was submitted (at the embassy, or
// online for an e-visa), every traveller's outcome is recorded at once, Approved or Refused, with nothing typed (amended
// 23 Oct 2026, change request 21). The case moves to Decision, due the next open office day at 11:00 ⚠️. Change then
// adds an approved one's sticker (or e-visa) number and its dates, each optional.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

interface DecisionDto {
  outcome: "APPROVED" | "REFUSED";
  visaNo: string | null;
  validFrom: string | null;
  validTo: string | null;
}
interface CaseDto {
  updatedAt: string;
  dueAt: string;
  stage: { code: string };
  decision: { at: string; by: { name: string } | null } | null;
  travellers: { id: string; name: string | null; decision: DecisionDto | null }[];
}
type Case = Awaited<ReturnType<typeof dispatchCase>>;
type Outcome = { travellerId: string; outcome: string; visaNo?: string | null; validFrom?: string | null; validTo?: string | null };

const neha = () => loginAs("neha@masti.test");
const load = async (agent: Agent, caseNo: string) => (await agent.get(`/api/visa/cases/${caseNo}`)).body.case as CaseDto;
const reason = async (code: string) => (await prisma.enquiryReason.findUniqueOrThrow({ where: { code } })).id;

/** A Wednesday at least 10 days out: an open day for the French embassy in Mumbai. */
function aWednesday() {
  let day = addDays(istToday(), 10);
  while (isoWeekday(day) !== 3) day = addDays(day, 1);
  return day;
}
const FROM = addDays(istToday(), 20);
const TO = addDays(istToday(), 60);

async function raise(agent: Agent, c: Case, clientName = "Rakesh Mehta") {
  await makeInvoiceable(agent, c, { clientName });
  const { quoteUpdatedAt, taxType, gstRatePercent, totalPaise } = (await agent.get(`/api/visa/cases/${c.caseNo}/invoice/check`)).body.preview;
  expect((await agent.post(`/api/visa/cases/${c.caseNo}/invoice`).send({ quoteUpdatedAt, taxType, gstRatePercent, totalPaise })).status).toBe(200);
}

/** Names the case's two travellers (an adult and a child), as Step 2 would: Rakesh and Aarav. */
async function name(c: { id: string }, adult = "Rakesh Mehta", child = "Aarav Mehta") {
  const [a, k] = await prisma.visaCaseTraveller.findMany({ where: { caseId: c.id }, orderBy: { position: "asc" } });
  await prisma.visaCaseTraveller.update({ where: { id: a!.id }, data: { name: adult } });
  await prisma.visaCaseTraveller.update({ where: { id: k!.id }, data: { name: child } });
  return { adult: a!.id, child: k!.id };
}

/**
 * Mehta's file, Neha's, dispatched alone to Global Visa Services, with the vendor's "got it" and (unless `submitted` is
 * false) the embassy submission saved. `extra` and `vendorId` make another family's file.
 */
async function atVendor({ submitted = true, extra, vendorId, clientName = "Rakesh Mehta" }: { submitted?: boolean; extra?: Record<string, unknown>; vendorId?: number; clientName?: string } = {}) {
  if (!(await prisma.user.findUnique({ where: { email: "vimal@masti.test" } }))) await mastiReady();
  const c = await dispatchCase({ ...(vendorId ? { vendorId } : {}), ...(extra ? { extra } : {}) });
  const processor = await neha();
  const seen = (await load(processor, c.caseNo)).updatedAt;
  expect((await processor.post(`/api/visa/cases/${c.caseNo}/docket`).send({ mode: "OWN", updatedAt: seen })).status).toBe(200);
  await raise(processor, c, clientName);
  const courier = await prisma.courier.findUniqueOrThrow({ where: { code: "BLUE_DART" } });
  expect((await processor.post(`/api/visa/cases/${c.caseNo}/dispatch`).send({ courierId: courier.id, awbNo: "12345678", caseNos: [c.caseNo] })).status).toBe(200);
  const received = (await load(processor, c.caseNo)).updatedAt;
  expect((await processor.post(`/api/visa/cases/${c.caseNo}/vendor-received`).send({ updatedAt: received })).status).toBe(200);
  await appointmentsHeld(c.id);
  if (submitted) {
    const embassy = await prisma.embassy.findUniqueOrThrow({ where: { code: "FR-MUM" } });
    const now = (await load(processor, c.caseNo)).updatedAt;
    const sub = await processor
      .put(`/api/visa/cases/${c.caseNo}/submission`)
      .send({ vendorFileNo: "FR-MUM88421", embassyId: embassy.id, collectionOn: aWednesday(), updatedAt: now });
    expect(sub.status).toBe(200);
  }
  const ids = await name(c, clientName, "Aarav Mehta");
  return { c, processor, ...ids };
}

/** "Record the decision" with the case's updatedAt as the page has it (or `updatedAt`). */
async function record(agent: Agent, caseNo: string, outcomes: Outcome[], updatedAt?: string) {
  // Read first: a request awaited inside another's .send(...) breaks supertest.
  const seen = updatedAt ?? (await load(agent, caseNo)).updatedAt;
  return agent.post(`/api/visa/cases/${caseNo}/decision`).send({ outcomes, updatedAt: seen });
}

const approved = (travellerId: string): Outcome => ({ travellerId, outcome: "APPROVED" });
const refused = (travellerId: string): Outcome => ({ travellerId, outcome: "REFUSED" });
/** An approved one's details, as Change adds them. */
const details = (visaNo = "0182 4471") => ({ outcome: "APPROVED", visaNo, validFrom: FROM, validTo: TO });

/** The case's updatedAt now, read from the database (so it works for users who can't open the case too). */
const caseUpdatedAt = async (caseNo: string) =>
  (await prisma.enquiry.findUniqueOrThrow({ where: { caseNo }, select: { updatedAt: true } })).updatedAt.toISOString();

/** "Change" on one traveller's row at Step 6, with the case's updatedAt as it is now (or `updatedAt`). */
async function change(agent: Agent, caseNo: string, travellerId: string, body: Omit<Outcome, "travellerId">, updatedAt?: string) {
  // Read first: a request awaited inside another's .send(...) breaks supertest.
  const seen = updatedAt ?? (await caseUpdatedAt(caseNo));
  return agent.put(`/api/visa/cases/${caseNo}/travellers/${travellerId}/decision`).send({ ...body, updatedAt: seen });
}

describe("Record the decision (Decisions 2, 3 and 6)", () => {
  it("saves everyone at once, with nothing typed, and moves the case to Decision, due the next open office day at 11:00", async () => {
    const { c, processor, adult, child } = await atVendor();
    // A number or dates sent along are ignored: they're added with Change (amended 23 Oct 2026).
    const res = await record(processor, c.caseNo, [{ ...approved(adult), visaNo: "0182 4471", validFrom: FROM, validTo: TO }, refused(child)]);
    expect(res.status).toBe(200);
    const after = res.body.case as CaseDto;
    expect(after.stage.code).toBe("DECISION");
    expect(after.decision).toMatchObject({ by: { name: "Neha Joshi" } });
    expect(after.dueAt).toBe(istDateTimeToUtc(await nextOpenDay(addDays(istToday(), 1), { office: true }), "11:00").toISOString());
    expect(after.travellers.map((t) => t.decision)).toEqual([
      { outcome: "APPROVED", visaNo: null, validFrom: null, validTo: null },
      { outcome: "REFUSED", visaNo: null, validFrom: null, validTo: null },
    ]);

    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.decision.record" } });
    expect(row).toMatchObject({ entityType: "Enquiry", entityId: c.id, clientId: c.client.id });
    expect(row.before).toMatchObject({ stage: "AT_VENDOR" });
    expect(row.after).toMatchObject({ stage: "DECISION" });
    expect((row.after as { travellers: unknown }).travellers).toEqual([
      { name: "Rakesh Mehta", outcome: "APPROVED" },
      { name: "Aarav Mehta", outcome: "REFUSED" },
    ]);
    // A refusal changes no money: no credit note.
    expect(await prisma.creditNote.count()).toBe(0);
  });

  it("everyone refused needs no numbers; the due time follows visa.passportsBackCheck", async () => {
    const { c, processor, adult, child } = await atVendor();
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    expect((await (await loginAs("riya@masti.test")).put("/api/visa/settings").send({ passportsBackCheck: { afterDays: 3, at: "10:00" } })).status).toBe(200);
    const res = await record(processor, c.caseNo, [refused(adult), refused(child)]);
    expect(res.status).toBe(200);
    const after = res.body.case as CaseDto;
    expect(after.travellers.every((t) => t.decision?.outcome === "REFUSED")).toBe(true);
    expect(after.dueAt).toBe(istDateTimeToUtc(await nextOpenDay(addDays(istToday(), 3), { office: true }), "10:00").toISOString());
  });

  it("an e-visa, after Submitted online, records Approved with no number; Change adds its e-visa number", async () => {
    await mastiReady();
    const c = await dispatchCase();
    const { offeringId } = await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: c.id }, select: { offeringId: true } });
    await prisma.visaOffering.update({ where: { id: offeringId }, data: { vendorNeeded: false } });
    await prisma.visaCase.update({ where: { enquiryId: c.id }, data: { vendorId: null } });
    const processor = await neha();
    await raise(processor, c);
    const seen = (await load(processor, c.caseNo)).updatedAt;
    expect((await processor.post(`/api/visa/cases/${c.caseNo}/submit-online`).send({ updatedAt: seen })).status).toBe(200);
    const { adult, child } = await name(c);

    const res = await record(processor, c.caseNo, [approved(adult), approved(child)]);
    expect(res.status).toBe(200);
    expect((res.body.case as CaseDto).travellers.map((t) => t.decision?.visaNo)).toEqual([null, null]);
    const added = await change(processor, c.caseNo, adult, details("EV-2026/88213"));
    expect(added.status).toBe(200);
    expect((added.body.case as CaseDto).travellers.map((t) => t.decision?.visaNo)).toEqual(["EV-2026/88213", null]);
    // The words name an e-visa's number.
    expect((await change(processor, c.caseNo, child, { outcome: "REFUSED", visaNo: "EV-2026/88214" })).body.issues.decision).toEqual([
      "Aarav Mehta was refused: leave the e-visa number and dates empty.",
    ]);
  });
});

describe("what is refused", () => {
  it("a missing, unknown or repeated traveller, or no outcome", async () => {
    const { c, processor, adult, child } = await atVendor();
    const issue = async (outcomes: Outcome[]) => {
      const res = await record(processor, c.caseNo, outcomes);
      expect(res.status).toBe(400);
      return res.body.issues.outcomes as string[];
    };
    expect(await issue([approved(adult)])).toEqual(["Record Aarav Mehta's decision too."]);
    expect(await issue([approved(adult), refused("not-a-traveller")])).toEqual(["Someone on this list isn't on the case. Reload and try again."]);
    expect(await issue([approved(adult), refused(adult), refused(child)])).toEqual(["Rakesh Mehta is on the list twice."]);
    expect(await issue([{ travellerId: adult, outcome: "MAYBE" }, refused(child)])).toEqual(["Pick Approved or Refused for everyone."]);
    expect(await issue([])).toEqual(["Record a decision for everyone."]);
    expect(await prisma.visaCaseTraveller.count({ where: { outcome: { not: null } } })).toBe(0);
    expect((await load(processor, c.caseNo)).stage.code).toBe("AT_VENDOR");
  });

  it("before the embassy submission, at another step, once decided, on a stale page and when postponed", async () => {
    const { c, processor, adult, child } = await atVendor({ submitted: false });
    expect((await record(processor, c.caseNo, [approved(adult), refused(child)])).body.message).toBe("Mark it submitted at the embassy first.");

    const waiting = await dispatchCase({ vendorId: c.vendor.id, extra: { mobile: "98250 41235", clientName: "Sunil Shah" } });
    const w = await name(waiting, "Sunil Shah", "Diya Shah");
    expect((await record(processor, waiting.caseNo, [approved(w.adult), refused(w.child)])).body.message).toBe(
      "The decision is recorded while the file is at At vendor.",
    );

    const done = await atVendor({ extra: { mobile: "98250 41236", clientName: "Kiran Bhatt" }, vendorId: c.vendor.id, clientName: "Kiran Bhatt" });
    expect((await record(processor, done.c.caseNo, [approved(done.adult), refused(done.child)])).status).toBe(200);
    expect((await record(processor, done.c.caseNo, [approved(done.adult), refused(done.child)])).body.message).toBe(
      "The decision is recorded while the file is at At vendor.",
    );

    const embassy = await prisma.embassy.findUniqueOrThrow({ where: { code: "FR-MUM" } });
    const seen = (await load(processor, c.caseNo)).updatedAt;
    expect(
      (await processor.put(`/api/visa/cases/${c.caseNo}/submission`).send({ vendorFileNo: "FR-MUM88430", embassyId: embassy.id, collectionOn: aWednesday(), updatedAt: seen })).status,
    ).toBe(200);
    const fresh = (await load(processor, c.caseNo)).updatedAt;
    expect((await record(processor, c.caseNo, [approved(adult), refused(child)], "2026-01-01T00:00:00.000Z")).body.details.code).toBe("STALE");
    await prisma.enquiry.update({
      where: { id: c.id },
      data: { status: "POSTPONED", reasonId: await reason("TRAVEL_DATES_MOVED"), resumeOn: toDbDate(addMonths(istToday(), 1)) },
    });
    expect((await record(processor, c.caseNo, [approved(adult), refused(child)], fresh)).body.message).toMatch(/postponed/);
    expect(await prisma.auditLog.count({ where: { action: "visa.decision.record" } })).toBe(1);
  });
});

describe("who may record it", () => {
  it("its processor, the Visa HOD and the Head; not other staff, view-only users or other departments", async () => {
    const { c, adult, child, processor } = await atVendor();
    await createUser({ name: "Kiran", email: "kiran@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
    await createUser({ name: "Hetal", email: "hetal@masti.test", departments: [{ code: "HOLIDAYS", access: "EDIT" }] });
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const seen = (await load(processor, c.caseNo)).updatedAt;
    for (const email of ["kiran@masti.test", "meena@masti.test", "hetal@masti.test"]) {
      expect((await record(await loginAs(email), c.caseNo, [approved(adult), refused(child)], seen)).status).toBe(403);
    }
    const hod = await record(await loginAs("riya@masti.test"), c.caseNo, [approved(adult), refused(child)], seen);
    expect(hod.status).toBe(200);
    expect((hod.body.case as CaseDto).decision!.by!.name).toBe("Riya");

    const other = await atVendor({ extra: { mobile: "98250 41237", clientName: "Sunil Shah" }, vendorId: c.vendor.id, clientName: "Sunil Shah" });
    expect((await record(await loginAs("vimal@masti.test"), other.c.caseNo, [approved(other.adult), approved(other.child)])).status).toBe(200);
  });
});

describe("the database", () => {
  it("keeps an approved traveller's details optional but in order, the number's format, and decides only a submitted, unrecalled file", async () => {
    const { c, adult } = await atVendor({ submitted: false });
    const set = (data: Record<string, unknown>) => prisma.visaCaseTraveller.update({ where: { id: adult }, data });
    const day = (d: string) => toDbDate(d);
    // Undecided or refused: none of them.
    await expect(set({ visaNo: "0182 4471" })).rejects.toThrow(/VisaCaseTraveller_outcome_details/);
    await expect(set({ outcome: "REFUSED", visaNo: "0182 4471" })).rejects.toThrow(/VisaCaseTraveller_outcome_details/);
    await expect(set({ outcome: "REFUSED", validFrom: day(FROM) })).rejects.toThrow(/VisaCaseTraveller_outcome_details/);
    // Approved: each optional (amended 23 Oct 2026), but never ending before it starts.
    await expect(set({ outcome: "APPROVED", visaNo: "0182 4471", validFrom: day(TO), validTo: day(FROM) })).rejects.toThrow(/VisaCaseTraveller_outcome_details/);
    await expect(set({ outcome: "APPROVED", visaNo: "0182  4471", validFrom: day(FROM), validTo: day(TO) })).rejects.toThrow(/VisaCaseTraveller_visa_no_format/);
    await expect(set({ outcome: "APPROVED", visaNo: "fra 0182", validFrom: day(FROM), validTo: day(TO) })).rejects.toThrow(/VisaCaseTraveller_visa_no_format/);
    await set({ outcome: "APPROVED" });
    await set({ visaNo: "FRA 0182/4471-A" });
    await set({ validFrom: day(FROM) });
    await set({ visaNo: null, validTo: day(FROM) });

    const neha = await prisma.user.findUniqueOrThrow({ where: { email: "neha@masti.test" } });
    const decide = (data: Record<string, unknown>) => prisma.visaCase.update({ where: { enquiryId: c.id }, data });
    await expect(decide({ decidedAt: new Date(), decidedById: neha.id })).rejects.toThrow(/VisaCase_decided_after_submission/);

    const embassy = await prisma.embassy.findUniqueOrThrow({ where: { code: "FR-MUM" } });
    const recall = await prisma.recallReason.findUniqueOrThrow({ where: { code: "EMBASSY_DELAY" } });
    const submitted = { vendorFileNo: "FR-MUM88421", embassyId: embassy.id, collectionOn: day(aWednesday()), submittedAt: new Date(), submittedById: neha.id };
    await expect(decide({ ...submitted, decidedAt: new Date() })).rejects.toThrow(/VisaCase_decision_together/);
    await expect(
      decide({ ...submitted, decidedAt: new Date(), decidedById: neha.id, recalledAt: new Date(), recalledById: neha.id, recallReasonId: recall.id }),
    ).rejects.toThrow(/VisaCase_decided_not_recalled/);
    await decide({ ...submitted, decidedAt: new Date(), decidedById: neha.id });
  });
});

describe("Change a traveller's decision (Decision 6)", () => {
  /** Mehta's file at Step 6: Rakesh approved, Aarav refused, nothing typed. */
  async function decided() {
    const at = await atVendor();
    expect((await record(at.processor, at.c.caseNo, [approved(at.adult), refused(at.child)])).status).toBe(200);
    return at;
  }

  it("adds the number and dates, corrects the outcome or just the number, and the audit log keeps the old and new values", async () => {
    const { c, processor, adult, child } = await decided();
    const before = await load(processor, c.caseNo);

    // After recording: Rakesh's sticker number and dates, cleaned up.
    const added = await change(processor, c.caseNo, adult, details(" fra 0182   4471 "));
    expect(added.status).toBe(200);
    expect((added.body.case as CaseDto).travellers[0]!.decision).toEqual({ outcome: "APPROVED", visaNo: "FRA 0182 4471", validFrom: FROM, validTo: TO });

    // Refused → Approved, with nothing typed yet.
    const approve = await change(processor, c.caseNo, child, { outcome: "APPROVED" });
    expect(approve.status).toBe(200);
    expect((approve.body.case as CaseDto).travellers[1]!.decision).toEqual({ outcome: "APPROVED", visaNo: null, validFrom: null, validTo: null });

    // Only the number.
    const renumber = await change(processor, c.caseNo, adult, details("0182 4479"));
    expect((renumber.body.case as CaseDto).travellers[0]!.decision!.visaNo).toBe("0182 4479");

    // Approved → Refused clears the number and dates.
    const refuse = await change(processor, c.caseNo, adult, { outcome: "REFUSED" });
    expect(refuse.status).toBe(200);
    const after = refuse.body.case as CaseDto;
    expect(after.travellers[0]!.decision).toEqual({ outcome: "REFUSED", visaNo: null, validFrom: null, validTo: null });
    // The case's step, due time and "recorded by" stay; its updatedAt moves, so a page opened before can't save over it.
    expect(after.stage.code).toBe("DECISION");
    expect(after.dueAt).toBe(before.dueAt);
    expect(after.updatedAt).not.toBe(before.updatedAt);
    expect(after.decision).toEqual(before.decision);

    const rows = await prisma.auditLog.findMany({ where: { action: "visa.decision.change" }, orderBy: { id: "asc" } });
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      entityType: "VisaCaseTraveller",
      entityId: adult,
      clientId: c.client.id,
      before: { name: "Rakesh Mehta", outcome: "APPROVED", visaNo: null, validFrom: null, validTo: null },
      after: { name: "Rakesh Mehta", outcome: "APPROVED", visaNo: "FRA 0182 4471", validFrom: FROM, validTo: TO },
    });
    expect(rows[1]).toMatchObject({
      entityId: child,
      before: { name: "Aarav Mehta", outcome: "REFUSED" },
      after: { name: "Aarav Mehta", outcome: "APPROVED", visaNo: null, validFrom: null, validTo: null },
    });
    expect(rows[2]).toMatchObject({ before: { name: "Rakesh Mehta", visaNo: "FRA 0182 4471" }, after: { visaNo: "0182 4479" } });
    expect(rows[3]).toMatchObject({
      before: { outcome: "APPROVED", visaNo: "0182 4479" },
      after: { name: "Rakesh Mehta", outcome: "REFUSED", visaNo: null, validFrom: null, validTo: null },
    });

    // Saving what's already there writes nothing.
    expect((await change(processor, c.caseNo, adult, { outcome: "REFUSED" })).status).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "visa.decision.change" } })).toBe(4);
    // A change moves no money.
    expect(await prisma.creditNote.count()).toBe(0);
  });

  it("takes each detail on its own: a number alone, one date, or clearing the number again", async () => {
    const { c, processor, adult } = await decided();
    const decision = async (body: Omit<Outcome, "travellerId">) => {
      const res = await change(processor, c.caseNo, adult, body);
      expect(res.status).toBe(200);
      return (res.body.case as CaseDto).travellers[0]!.decision;
    };
    expect(await decision({ outcome: "APPROVED", visaNo: "0182 4471" })).toEqual({ outcome: "APPROVED", visaNo: "0182 4471", validFrom: null, validTo: null });
    expect(await decision({ outcome: "APPROVED", visaNo: "0182 4471", validFrom: FROM })).toEqual({
      outcome: "APPROVED",
      visaNo: "0182 4471",
      validFrom: FROM,
      validTo: null,
    });
    // Left out or sent as null, a detail is cleared.
    expect(await decision({ outcome: "APPROVED", visaNo: null, validFrom: FROM, validTo: TO })).toEqual({ outcome: "APPROVED", visaNo: null, validFrom: FROM, validTo: TO });
    expect(await decision({ outcome: "APPROVED" })).toEqual({ outcome: "APPROVED", visaNo: null, validFrom: null, validTo: null });
  });

  it("refuses a change saved after someone else's (STALE), so two open dialogs can't undo each other", async () => {
    const { c, processor, adult } = await decided();
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    // Both open "Change" on the adult's row before either saves.
    const opened = await caseUpdatedAt(c.caseNo);
    const first = await change(await loginAs("riya@masti.test"), c.caseNo, adult, { outcome: "APPROVED", visaNo: "0182 4479", validFrom: FROM, validTo: TO }, opened);
    expect(first.status).toBe(200);
    const late = await change(processor, c.caseNo, adult, { outcome: "REFUSED" }, opened);
    expect(late.status).toBe(409);
    expect(late.body.details.code).toBe("STALE");
    expect(late.body.message).toBe("Someone else changed this case after you opened it. Reload and try again.");
    // Riya's number stands, and only her change is in the audit log.
    expect((await prisma.visaCaseTraveller.findUniqueOrThrow({ where: { id: adult } })).visaNo).toBe("0182 4479");
    expect(await prisma.auditLog.count({ where: { action: "visa.decision.change" } })).toBe(1);
    // Reloaded, the processor's change goes through.
    expect((await change(processor, c.caseNo, adult, { outcome: "REFUSED" })).status).toBe(200);
  });

  it("refuses details that don't fit the outcome", async () => {
    const { c, processor, adult, child } = await decided();
    const issue = async (travellerId: string, body: Omit<Outcome, "travellerId">) => {
      const res = await change(processor, c.caseNo, travellerId, body);
      expect(res.status).toBe(400);
      return res.body.issues.decision as string[];
    };
    expect(await issue(child, { outcome: "APPROVED", visaNo: "0182 4472", validFrom: TO, validTo: FROM })).toEqual([
      "Aarav Mehta's visa can't end before it starts.",
    ]);
    expect(await issue(adult, { outcome: "REFUSED", visaNo: "0182 4471" })).toEqual(["Rakesh Mehta was refused: leave the sticker number and dates empty."]);
    expect(await issue(adult, { outcome: "REFUSED", validTo: TO })).toEqual(["Rakesh Mehta was refused: leave the sticker number and dates empty."]);
    const badNumber = await change(processor, c.caseNo, adult, details("01"));
    expect(badNumber.body.issues.visaNo).toEqual(["Use 3–40 letters, digits, spaces, - or /, starting and ending with a letter or digit."]);
    expect((await change(processor, c.caseNo, adult, details("0182 4471-"))).body.issues.visaNo).toHaveLength(1);
    // A blank number is a mistake in the request: the page sends null for an empty box.
    expect((await change(processor, c.caseNo, adult, details("  "))).body.issues.visaNo).toHaveLength(1);
    const noOutcome = await change(processor, c.caseNo, adult, { outcome: "MAYBE" });
    expect(noOutcome.body.issues.outcome).toEqual(["Pick Approved or Refused."]);

    // A traveller of another case.
    const other = await atVendor({ extra: { mobile: "98250 41238", clientName: "Sunil Shah" }, vendorId: c.vendor.id, clientName: "Sunil Shah" });
    expect((await change(processor, c.caseNo, other.adult, { outcome: "REFUSED" })).status).toBe(404);
    expect(await prisma.auditLog.count({ where: { action: "visa.decision.change" } })).toBe(0);
    expect((await load(processor, c.caseNo)).travellers.map((t) => t.decision?.outcome)).toEqual(["APPROVED", "REFUSED"]);
  });

  it("only at Decision or Passport back: not before it's recorded, once handed over, postponed or closed", async () => {
    const { c, processor, adult } = await atVendor();
    const atStep5 = await change(processor, c.caseNo, adult, { outcome: "REFUSED" });
    expect(atStep5.status).toBe(409);
    expect(atStep5.body.message).toBe("The decision can only be changed at Decision or Passport back, before the handover.");

    expect((await record(processor, c.caseNo, [approved(adult), refused((await load(processor, c.caseNo)).travellers[1]!.id)])).status).toBe(200);
    const { departmentId } = await prisma.enquiry.findUniqueOrThrow({ where: { id: c.id } });
    const step = (code: string) => prisma.departmentStage.findFirstOrThrow({ where: { departmentId, code } });
    // Handed over (Step 8): locked.
    await prisma.enquiry.update({ where: { id: c.id }, data: { stageId: (await step("DELIVERED")).id } });
    expect((await change(processor, c.caseNo, adult, { outcome: "REFUSED" })).body.message).toBe(
      "The decision can only be changed at Decision or Passport back, before the handover.",
    );

    await prisma.enquiry.update({
      where: { id: c.id },
      data: { stageId: (await step("DECISION")).id, status: "POSTPONED", reasonId: await reason("TRAVEL_DATES_MOVED"), resumeOn: toDbDate(addMonths(istToday(), 1)) },
    });
    expect((await change(processor, c.caseNo, adult, { outcome: "REFUSED" })).body.message).toMatch(/postponed/);
    await prisma.enquiry.update({ where: { id: c.id }, data: { status: "CANCELLED", reasonId: await reason("TRIP_CANCELLED"), resumeOn: null, dueAt: null } });
    expect((await change(processor, c.caseNo, adult, { outcome: "REFUSED" })).body.message).toMatch(/closed/);
    expect(await prisma.auditLog.count({ where: { action: "visa.decision.change" } })).toBe(0);
  });

  it("its processor, the Visa HOD and the Head; not other staff, view-only users or other departments", async () => {
    const { c, adult, child } = await decided();
    await createUser({ name: "Kiran", email: "kiran@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
    await createUser({ name: "Hetal", email: "hetal@masti.test", departments: [{ code: "HOLIDAYS", access: "EDIT" }] });
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    for (const email of ["kiran@masti.test", "meena@masti.test", "hetal@masti.test"]) {
      expect((await change(await loginAs(email), c.caseNo, adult, { outcome: "REFUSED" })).status).toBe(403);
    }
    expect((await change(await loginAs("riya@masti.test"), c.caseNo, adult, { outcome: "REFUSED" })).status).toBe(200);
    const head = await change(await loginAs("vimal@masti.test"), c.caseNo, child, { outcome: "APPROVED", visaNo: "0182 4472", validFrom: FROM, validTo: TO });
    expect(head.status).toBe(200);
    const rows = await prisma.auditLog.findMany({ where: { action: "visa.decision.change" }, orderBy: { id: "asc" }, include: { actor: true } });
    expect(rows.map((r) => r.actor?.name)).toEqual(["Riya", "Vimal"]);
  });
});
