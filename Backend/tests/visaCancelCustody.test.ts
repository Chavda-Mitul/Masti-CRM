import { beforeEach, describe, expect, it } from "vitest";
import { addDays, addMonths, istDateTimeToUtc, istToday } from "../src/lib/dates";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { nextOpenDay } from "../src/modules/holidays/blockedDays";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { aWednesday, decidedCase, dispatchCase, makeInvoiceable, mastiReady, saveCase, visaStaff, type Agent } from "./visaHelpers";

// A cancelled case's passports still come back (docs/decisions/0006-visa-documents.md amendment 15). Cancel stays
// possible at every step, but a file that went to the vendor can still be taken back, sent on its way back (and its days
// changed), received and handed over. The case stays cancelled, and stays on its owner's Open list with a due time until
// the handover. What only an open case does (Vendor got it, the submission, the decision) stays refused.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

interface CaseDto {
  updatedAt: string;
  status: string;
  dueAt: string | null;
  stage: { code: string };
  invoice: { invoiceNo: string } | null;
  recall: { reason: string } | null;
  travellers: { id: string }[];
}
interface Row {
  caseNo: string;
  status: string;
  toHandBack: boolean;
}

/** A small "JPEG": the server checks a photo's first bytes, not the picture. */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const load = async (agent: Agent, caseNo: string) => (await agent.get(`/api/visa/cases/${caseNo}`)).body.case as CaseDto;
const reason = async (code: string) => (await prisma.enquiryReason.findUniqueOrThrow({ where: { code } })).id;
const recallReason = async () => (await prisma.recallReason.findUniqueOrThrow({ where: { code: "CLIENT_CANCELLED_TRIP" } })).id;
const listed = async (agent: Agent, status = "OPEN") => (await agent.get(`/api/enquiries?status=${status}`)).body.enquiries as Row[];
/** The next open office day `days` from today, at `at` (IST): how the visa settings' due times fall. */
const officeDay = async (days: number, at: string) => istDateTimeToUtc(await nextOpenDay(addDays(istToday(), days), { office: true }), at).toISOString();

/** "Postpone or cancel" → Cancel the case, reason Trip cancelled. Reads first: never await inside .send(...). */
async function cancel(agent: Agent, caseNo: string) {
  const { updatedAt } = await load(agent, caseNo);
  const reasonId = await reason("TRIP_CANCELLED");
  return agent.post(`/api/enquiries/${caseNo}/cancel`).send({ reasonId, updatedAt });
}

/** "Take the file back", reason Client cancelled the trip, against the invoice the dialog shows (or `invoiceNo`). */
async function recall(agent: Agent, caseNo: string, body: { invoiceNo?: string | null; refunds?: { position: number; refundPaise: number }[] } = {}) {
  const c = await load(agent, caseNo);
  const reasonId = await recallReason();
  const invoiceNo = body.invoiceNo === undefined ? c.invoice!.invoiceNo : body.invoiceNo;
  return agent.post(`/api/visa/cases/${caseNo}/recall`).send({ ...body, invoiceNo, reasonId, updatedAt: c.updatedAt });
}

/** "Passports on the way back" (POST) or its "Change" (PUT): collected today, expected `days` out on an open day. */
async function sendBack(agent: Agent, caseNo: string, days = 2, method: "post" | "put" = "post") {
  const { updatedAt } = await load(agent, caseNo);
  const expectedOn = await nextOpenDay(addDays(istToday(), days), { office: true });
  return agent[method](`/api/visa/cases/${caseNo}/passports-back`).send({ collectedOn: istToday(), expectedOn, updatedAt });
}

/** "Mark received": 2 current + 0 old counted; `stickers` for the approved travellers. */
async function receive(agent: Agent, caseNo: string, stickers: { travellerId: string; check: string }[] = []) {
  const { updatedAt } = await load(agent, caseNo);
  return agent.post(`/api/visa/cases/${caseNo}/passports-received`).send({ booklets: { current: 2, old: 0 }, stickers, updatedAt });
}

/** "Hand over to the client" at the office: 2 + 0 counted, the first traveller collecting, a fresh photo. */
async function handOver(agent: Agent, caseNo: string) {
  const c = await load(agent, caseNo);
  const photoId = (await agent.post(`/api/visa/cases/${caseNo}/handover/photo`).set("Content-Type", "image/jpeg").send(JPEG)).body.photo.id;
  return agent
    .post(`/api/visa/cases/${caseNo}/handover`)
    .send({ mode: "OFFICE", booklets: { current: 2, old: 0 }, receiver: { travellerId: c.travellers[0]!.id }, photoId, updatedAt: c.updatedAt });
}

describe("a case cancelled after its file went to the vendor (0006 amendment 15)", () => {
  it("at the vendor: due now and still on the Open list; taken back, on its way, received and handed over, still cancelled", async () => {
    const { c, processor } = await decidedCase({ decided: false });
    const before = Date.now();
    expect((await cancel(processor, c.caseNo)).status).toBe(200);
    const cancelled = await load(processor, c.caseNo);
    expect(cancelled.status).toBe("CANCELLED");
    expect(new Date(cancelled.dueAt!).getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(new Date(cancelled.dueAt!).getTime()).toBeLessThanOrEqual(Date.now());
    const logged = await prisma.auditLog.findFirstOrThrow({ where: { action: "enquiry.cancel" } });
    expect(logged.after).toMatchObject({ status: "CANCELLED", toHandBack: true });
    expect((await listed(processor)).find((r) => r.caseNo === c.caseNo)).toMatchObject({ status: "CANCELLED", toHandBack: true });
    expect((await listed(processor, "CANCELLED")).map((r) => r.caseNo)).toEqual([c.caseNo]);

    const taken = await recall(processor, c.caseNo);
    expect(taken.status).toBe(200);
    expect(taken.body.case as CaseDto).toMatchObject({ status: "CANCELLED", stage: { code: "PASSPORT_BACK" }, dueAt: await officeDay(1, "11:00") });
    expect(await prisma.creditNote.count({ where: { kind: "PART" } })).toBe(1);

    const sent = await sendBack(processor, c.caseNo, 2);
    expect(sent.status).toBe(200);
    const expectedOn = await nextOpenDay(addDays(istToday(), 2), { office: true });
    expect(sent.body.case as CaseDto).toMatchObject({ status: "CANCELLED", dueAt: istDateTimeToUtc(expectedOn, "11:00").toISOString() });
    expect((await sendBack(processor, c.caseNo, 4, "put")).status).toBe(200);

    const received = await receive(processor, c.caseNo);
    expect(received.status).toBe(200);
    expect(received.body.case as CaseDto).toMatchObject({ status: "CANCELLED", dueAt: await officeDay(1, "11:00") });

    const handed = await handOver(processor, c.caseNo);
    expect(handed.status).toBe(200);
    expect(handed.body.case as CaseDto).toMatchObject({ status: "CANCELLED", stage: { code: "DELIVERED" }, dueAt: null });
    expect((await listed(processor)).map((r) => r.caseNo)).not.toContain(c.caseNo);
    expect((await listed(processor, "CANCELLED")).find((r) => r.caseNo === c.caseNo)).toMatchObject({ toHandBack: false });
  });

  it("at the vendor after its invoice was cancelled whole: the recall gives nothing back", async () => {
    const { c, processor } = await decidedCase({ decided: false });
    const shown = (await processor.get(`/api/visa/cases/${c.caseNo}/invoice/cancel/check`)).body;
    const wrong = await prisma.creditNoteReason.findUniqueOrThrow({ where: { code: "WRONG_AMOUNT" } });
    const whole = { invoiceNo: shown.invoiceNo, totalPaise: shown.preview.totalPaise, reasonId: wrong.id };
    expect((await processor.post(`/api/visa/cases/${c.caseNo}/invoice/cancel`).send(whole)).status).toBe(200);
    expect((await cancel(processor, c.caseNo)).status).toBe(200);

    const look = (await processor.get(`/api/visa/cases/${c.caseNo}/recall/check`)).body;
    expect(look).toMatchObject({ invoiceNo: null, lines: [], defaultTotalPaise: 0, canChangeRefund: false, creditNoteNo: null, blockers: [] });
    const withRefund = await recall(processor, c.caseNo, { invoiceNo: null, refunds: [{ position: 1, refundPaise: 100 }] });
    expect(withRefund.status).toBe(400);
    expect(Object.keys(withRefund.body.issues)).toEqual(["refunds"]);
    expect((await recall(processor, c.caseNo, { invoiceNo: shown.invoiceNo })).body.details.code).toBe("RECALL_CHANGED");

    const res = await recall(processor, c.caseNo, { invoiceNo: null });
    expect(res.status).toBe(200);
    expect(res.body.case as CaseDto).toMatchObject({ status: "CANCELLED", stage: { code: "PASSPORT_BACK" }, recall: { reason: "Client cancelled the trip" } });
    expect(await prisma.creditNote.count()).toBe(1);
    const logged = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.recall" } });
    expect(logged.after).toMatchObject({ totalPaise: 0, creditNoteNo: null, refunds: [] });
  });

  it("at Decision: keeps its due time, and its passports go on their way back", async () => {
    const { c, processor, adult } = await decidedCase();
    const before = await load(processor, c.caseNo);
    expect((await cancel(processor, c.caseNo)).status).toBe(200);
    expect(await load(processor, c.caseNo)).toMatchObject({ status: "CANCELLED", dueAt: before.dueAt });
    expect((await listed(processor)).find((r) => r.caseNo === c.caseNo)).toMatchObject({ toHandBack: true });
    expect((await sendBack(processor, c.caseNo)).status).toBe(200);
    expect((await receive(processor, c.caseNo, [{ travellerId: adult, check: "MATCHES" }])).status).toBe(200);
    expect((await handOver(processor, c.caseNo)).body.case as CaseDto).toMatchObject({ status: "CANCELLED", stage: { code: "DELIVERED" } });
  });

  it("only the way back: the submission and the decision stay refused, a colleague can't, a postponed one is resumed first", async () => {
    const { c, processor, adult, child } = await decidedCase({ decided: false });
    expect((await cancel(processor, c.caseNo)).status).toBe(200);
    const embassy = await prisma.embassy.findUniqueOrThrow({ where: { code: "FR-MUM" } });
    const { updatedAt } = await load(processor, c.caseNo);
    const changed = await processor
      .put(`/api/visa/cases/${c.caseNo}/submission`)
      .send({ vendorFileNo: "FR-MUM88422", embassyId: embassy.id, collectionOn: aWednesday(), updatedAt });
    expect(changed.status).toBe(409);
    expect(changed.body.message).toMatch(/closed/);
    const outcomes = [
      { travellerId: adult, outcome: "APPROVED" },
      { travellerId: child, outcome: "REFUSED" },
    ];
    const decided = await processor.post(`/api/visa/cases/${c.caseNo}/decision`).send({ outcomes, updatedAt });
    expect(decided.status).toBe(409);
    expect(decided.body.message).toMatch(/closed/);

    await createUser({ name: "Kiran Desai", email: "kiran@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    const colleague = await loginAs("kiran@masti.test");
    const theirs = await colleague.post(`/api/visa/cases/${c.caseNo}/recall`).send({ invoiceNo: "MVI00000001", reasonId: await recallReason(), updatedAt });
    expect(theirs.status).toBe(403);

    const other = await decidedCase({ decided: false, extra: { mobile: "98250 41236", clientName: "Kiran Bhatt" }, vendorId: c.vendor.id });
    const seen = await load(processor, other.c.caseNo);
    const resumeOn = addMonths(istToday(), 1);
    const postponed = await processor
      .post(`/api/enquiries/${other.c.caseNo}/postpone`)
      .send({ reasonId: await reason("TRAVEL_DATES_MOVED"), resumeOn, updatedAt: seen.updatedAt });
    expect(postponed.status).toBe(200);
    const onHold = await recall(processor, other.c.caseNo);
    expect(onHold.status).toBe(409);
    expect(onHold.body.message).toMatch(/Resume it first/);
    // Cancelling a postponed case with its passports out makes it due now, not on its resume day.
    expect((await cancel(processor, other.c.caseNo)).status).toBe(200);
    expect(new Date((await load(processor, other.c.caseNo)).dueAt!).getTime()).toBeLessThanOrEqual(Date.now());
    expect((await recall(processor, other.c.caseNo)).status).toBe(200);
  });
});

describe("a case cancelled with nothing to hand back is as before", () => {
  it("before dispatch, or an e-visa: no due time, off the Open list", async () => {
    await mastiReady();
    const ready = await dispatchCase();
    const processor = await loginAs("neha@masti.test");
    expect((await cancel(processor, ready.caseNo)).status).toBe(200);
    expect(await load(processor, ready.caseNo)).toMatchObject({ status: "CANCELLED", dueAt: null });
    expect((await listed(processor)).map((r) => r.caseNo)).not.toContain(ready.caseNo);
    expect((await listed(processor, "CANCELLED")).find((r) => r.caseNo === ready.caseNo)).toMatchObject({ toHandBack: false });

    // An e-visa: Vendor needed off, invoiced and "Submitted online". Its passports never left the office.
    const e = await dispatchCase({ vendorId: ready.vendor.id, extra: { mobile: "98250 41299", clientName: "Asha Desai" } });
    const { offeringId } = await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: e.id }, select: { offeringId: true } });
    await prisma.visaOffering.update({ where: { id: offeringId }, data: { vendorNeeded: false } });
    await prisma.visaCase.update({ where: { enquiryId: e.id }, data: { vendorId: null } });
    await makeInvoiceable(processor, e, { clientName: "Asha Desai" });
    const { quoteUpdatedAt, taxType, gstRatePercent, totalPaise } = (await processor.get(`/api/visa/cases/${e.caseNo}/invoice/check`)).body.preview;
    expect((await processor.post(`/api/visa/cases/${e.caseNo}/invoice`).send({ quoteUpdatedAt, taxType, gstRatePercent, totalPaise })).status).toBe(200);
    const seen = (await load(processor, e.caseNo)).updatedAt;
    expect((await processor.post(`/api/visa/cases/${e.caseNo}/submit-online`).send({ updatedAt: seen })).status).toBe(200);
    expect((await cancel(processor, e.caseNo)).status).toBe(200);
    expect(await load(processor, e.caseNo)).toMatchObject({ status: "CANCELLED", dueAt: null });
    expect((await listed(processor)).map((r) => r.caseNo)).not.toContain(e.caseNo);
  });
});

describe("before dispatch: passports held at our office are handed back (component 3)", () => {
  /** Aarti's case at Step 2 (Documents), with `booklets` counted in at intake unless none. */
  async function atDocuments(booklets?: { current: number; old: number }) {
    const staff = await visaStaff();
    const c = await saveCase(staff);
    expect((await staff.post(`/api/visa/cases/${c.caseNo}/start`).send({})).status).toBe(200);
    if (booklets) {
      const counted = await staff.patch(`/api/visa/cases/${c.caseNo}`).send({ bookletsCurrent: booklets.current, bookletsOld: booklets.old });
      expect(counted.status).toBe(200);
    }
    return { staff, c };
  }

  /** "Hand back" at the desk: the photo first, then the count and who collected them. */
  async function handBack(agent: Agent, caseNo: string, booklets: { current: number; old: number }) {
    const { updatedAt } = await load(agent, caseNo);
    const photo = await agent.post(`/api/visa/cases/${caseNo}/handover/photo`).set("Content-Type", "image/jpeg").send(JPEG);
    if (photo.status !== 200) return photo;
    return agent
      .post(`/api/visa/cases/${caseNo}/handover`)
      .send({ mode: "OFFICE", booklets, receiver: { name: "Sunita Mehta" }, photoId: photo.body.photo.id, updatedAt });
  }

  it("a cancelled case keeps them on the list, due for the hand-back; any Visa staff hands them back; it stays at its step", async () => {
    const { staff, c } = await atDocuments({ current: 2, old: 1 });
    expect((await cancel(staff, c.caseNo)).status).toBe(200);
    expect(await load(staff, c.caseNo)).toMatchObject({ status: "CANCELLED", dueAt: await officeDay(1, "11:00") });
    expect((await listed(staff)).find((r) => r.caseNo === c.caseNo)).toMatchObject({ status: "CANCELLED", toHandBack: true });

    // Whoever is at the desk: a colleague who doesn't own the case can open it while the passports are with us.
    await createUser({ name: "Kiran Desai", email: "kiran@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    const colleague = await loginAs("kiran@masti.test");
    expect((await colleague.get(`/api/visa/cases/${c.caseNo}`)).status).toBe(200);
    expect((await listed(colleague)).map((r) => r.caseNo)).toEqual([c.caseNo]);

    const short = await handBack(colleague, c.caseNo, { current: 1, old: 1 });
    expect(short.status).toBe(400);
    expect(short.body.issues.booklets).toEqual(["Count again: our stock has 2 current + 1 old. Find what's missing before handing over."]);

    const res = await handBack(colleague, c.caseNo, { current: 2, old: 1 });
    expect(res.status).toBe(200);
    expect(res.body.case).toMatchObject({
      status: "CANCELLED",
      stage: { code: "DOCUMENTS" },
      dueAt: null,
      handover: { mode: "OFFICE", booklets: { current: 2, old: 1 }, receiver: { name: "Sunita Mehta" }, by: { name: "Kiran Desai" } },
    });
    const logged = await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.handover" } });
    expect(logged.after).toMatchObject({ stage: "DOCUMENTS", beforeDispatch: true, status: "CANCELLED" });

    // Handed back: the colleague can't open it any more, and it's off the Open list.
    expect((await colleague.get(`/api/visa/cases/${c.caseNo}`)).status).toBe(403);
    expect((await listed(staff)).map((r) => r.caseNo)).not.toContain(c.caseNo);
    expect((await handBack(staff, c.caseNo, { current: 2, old: 1 })).body.message).toBe("The passports are already handed over.");
  });

  it("nothing counted in: no hand-back, no due time; and an open case's passports aren't handed back", async () => {
    const { staff, c } = await atDocuments();
    expect((await cancel(staff, c.caseNo)).status).toBe(200);
    expect(await load(staff, c.caseNo)).toMatchObject({ status: "CANCELLED", dueAt: null });
    expect((await listed(staff)).map((r) => r.caseNo)).not.toContain(c.caseNo);
    const nothing = await handBack(staff, c.caseNo, { current: 1, old: 0 });
    expect(nothing.status).toBe(409);
    expect(nothing.body.message).toBe("No booklets were counted in for this case: there's nothing to hand back.");

    const open = await saveCase(staff, { mobile: "98250 41236", clientName: "Kiran Bhatt" });
    expect((await staff.post(`/api/visa/cases/${open.caseNo}/start`).send({})).status).toBe(200);
    expect((await staff.patch(`/api/visa/cases/${open.caseNo}`).send({ bookletsCurrent: 1, bookletsOld: 0 })).status).toBe(200);
    const notCancelled = await handBack(staff, open.caseNo, { current: 1, old: 0 });
    expect(notCancelled.status).toBe(409);
    expect(notCancelled.body.message).toBe("Only a cancelled case's passports are handed back before they go to the vendor.");
  });

  it("the delivery boy isn't booked for them: the office hand-back only", async () => {
    const { staff, c } = await atDocuments({ current: 1, old: 0 });
    await prisma.client.update({ where: { id: c.client.id }, data: { email: "rakesh@example.com", addressLine: "B-702, Raghuvir Residency", city: "Surat", pincode: "395007" } });
    expect((await cancel(staff, c.caseNo)).status).toBe(200);
    const ramesh = await createUser({ name: "Ramesh", mobile: "+919825000001", type: "FIELD" });
    const { updatedAt } = await load(staff, c.caseNo);
    const slot = await prisma.fieldSlot.findUniqueOrThrow({ where: { code: "EVENING" } });
    const day = await nextOpenDay(addDays(istToday(), 1), { office: true });
    const booked = await staff
      .post(`/api/visa/cases/${c.caseNo}/field-jobs`)
      .send({ kind: "DELIVERY", assigneeId: ramesh.id, day, slotId: slot.id, address: "B-702, Raghuvir Residency, Vesu, Surat 395007", updatedAt });
    expect(booked.status).toBe(409);
    expect(booked.body.message).toBe("Mark the passports received first.");
  });
});
