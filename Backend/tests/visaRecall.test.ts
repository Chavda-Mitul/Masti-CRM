import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it } from "vitest";
import { addDays, addMonths, istDateTimeToUtc, istToday, toDbDate } from "../src/lib/dates";
import { getObject } from "../src/lib/storage";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { dispatchCase, holdCaseLock, makeInvoiceable, mastiReady, untilWaitingOnLock, type Agent } from "./visaHelpers";

// Taking a file back from the vendor (docs/decisions/0011-visa-at-vendor.md Decision 6): a PART credit note gives back
// the embassy fee (nothing on a lump sum); only the Visa HOD or the Head gives back more; the case goes to Passport back.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

interface CaseDto {
  updatedAt: string;
  dueAt: string;
  stage: { code: string };
  invoice: { invoiceNo: string; cancelled: unknown; partCredits: { creditNoteNo: string; totalPaise: number; reason: string }[] } | null;
  recall: { at: string; by: { name: string } | null; reason: string; creditNote: { creditNoteNo: string; totalPaise: number; file: { fileName: string } } | null } | null;
}
type Case = Awaited<ReturnType<typeof dispatchCase>>;

const neha = () => loginAs("neha@masti.test");
const load = async (agent: Agent, caseNo: string) => (await agent.get(`/api/visa/cases/${caseNo}`)).body.case as CaseDto;
const check = (agent: Agent, caseNo: string) => agent.get(`/api/visa/cases/${caseNo}/recall/check`);
const recallReason = async (code = "EMBASSY_DELAY") => (await prisma.recallReason.findUniqueOrThrow({ where: { code } })).id;
const reason = async (code: string) => (await prisma.enquiryReason.findUniqueOrThrow({ where: { code } })).id;

async function raise(agent: Agent, caseNo: string) {
  const { quoteUpdatedAt, taxType, gstRatePercent, totalPaise } = (await agent.get(`/api/visa/cases/${caseNo}/invoice/check`)).body.preview;
  expect((await agent.post(`/api/visa/cases/${caseNo}/invoice`).send({ quoteUpdatedAt, taxType, gstRatePercent, totalPaise })).status).toBe(200);
}

/** Every traveller a lump sum of ₹3,000, so the invoice has no embassy fee. */
async function lumpSums(agent: Agent, c: Case) {
  const updatedAt = (await agent.get(`/api/visa/cases/${c.caseNo}`)).body.case.quote.updatedAt;
  const travellers = await prisma.visaCaseTraveller.findMany({ where: { caseId: c.id }, orderBy: { position: "asc" } });
  const speed = await prisma.processingSpeed.findUniqueOrThrow({ where: { code: "NORMAL" } });
  const res = await agent.put(`/api/visa/cases/${c.caseNo}/quote`).send({
    processingSpeedId: speed.id,
    serviceChargePaise: 50_000,
    lines: travellers.map((t) => ({ travellerId: t.id, form: "LUMP_SUM", lumpSumPaise: 300_000 })),
    updatedAt,
  });
  expect(res.status).toBe(200);
}

/**
 * Neha's file at At vendor: invoiced from makeInvoiceable's quote (the adult itemised, embassy ₹500 + VFS ₹800 + other
 * ₹2,110; the child a lump sum of ₹2,000; service ₹500), sent on its own By hand. `lump` makes every traveller a lump sum.
 */
async function atVendor({ lump = false, mobile, clientName }: { lump?: boolean; mobile?: string; clientName?: string } = {}) {
  if (!(await prisma.user.findUnique({ where: { email: "vimal@masti.test" } }))) await mastiReady();
  // A second file goes to the same vendor: readyCase would add it again otherwise.
  const vendorId = (await prisma.vendor.findFirst())?.id;
  const c = await dispatchCase({ ...(vendorId ? { vendorId } : {}), ...(mobile ? { extra: { mobile, clientName } } : {}) });
  const processor = await neha();
  await makeInvoiceable(processor, c, clientName ? { clientName } : {});
  if (lump) await lumpSums(processor, c);
  await raise(processor, c.caseNo);
  const seen = (await load(processor, c.caseNo)).updatedAt;
  expect((await processor.post(`/api/visa/cases/${c.caseNo}/docket`).send({ mode: "OWN", updatedAt: seen })).status).toBe(200);
  const courier = await prisma.courier.findUniqueOrThrow({ where: { code: "BY_HAND" } });
  expect((await processor.post(`/api/visa/cases/${c.caseNo}/dispatch`).send({ courierId: courier.id, awbNo: null, caseNos: [c.caseNo] })).status).toBe(200);
  return { c, processor };
}

/** Presses Recall with what the dialog shows (or `body`'s), reading the case first: never await inside .send(...). */
async function recall(agent: Agent, caseNo: string, body: { reasonId?: number; refunds?: { position: number; refundPaise: number }[]; invoiceNo?: string; updatedAt?: string } = {}) {
  const updatedAt = body.updatedAt ?? (await load(agent, caseNo)).updatedAt;
  const invoiceNo = body.invoiceNo ?? (await load(agent, caseNo)).invoice!.invoiceNo;
  const reasonId = body.reasonId ?? (await recallReason());
  return agent.post(`/api/visa/cases/${caseNo}/recall`).send({ ...body, invoiceNo, reasonId, updatedAt });
}

describe("taking a file back (Decision 6)", () => {
  it("gives back the embassy fee in a PART credit note, keeps the rest, and moves the case to Passport back", async () => {
    const { c, processor } = await atVendor();
    const today = istToday();
    await prisma.holiday.create({
      data: { name: "Office closed", startDate: toDbDate(addDays(today, 1)), endDate: toDbDate(addDays(today, 1)), targets: { create: [{ kind: "MASTI_OFFICE" }] } },
    });
    const due = istDateTimeToUtc(addDays(today, 2), "11:00").toISOString();

    const look = (await check(processor, c.caseNo)).body;
    expect(look).toMatchObject({ invoiceNo: "MVI00000001", defaultTotalPaise: 50_000, canChangeRefund: false, creditNoteNo: "MCN00000001", dueAt: due, blockers: [] });
    expect(look.lines.map((l: { position: number; form: string; defaultRefundPaise: number; chargedPaise: number }) => [l.position, l.form, l.defaultRefundPaise, l.chargedPaise])).toEqual([
      [1, "ITEMISED", 50_000, 341_000],
      [2, "LUMP_SUM", 0, 200_000],
    ]);

    const res = await recall(processor, c.caseNo);
    expect(res.status).toBe(200);
    const after = res.body.case as CaseDto;
    expect(after.stage.code).toBe("PASSPORT_BACK");
    expect(after.dueAt).toBe(due);
    expect(after.recall).toMatchObject({ by: { name: "Neha Joshi" }, reason: "Embassy taking too long", creditNote: { creditNoteNo: "MCN00000001", totalPaise: 50_000 } });
    expect(after.invoice).toMatchObject({ invoiceNo: "MVI00000001", cancelled: null, partCredits: [{ creditNoteNo: "MCN00000001", totalPaise: 50_000, reason: "Recall" }] });

    const note = await prisma.creditNote.findUniqueOrThrow({ where: { creditNoteNo: "MCN00000001" }, include: { lines: true, file: true } });
    expect(note).toMatchObject({ kind: "PART", grossPaise: 50_000, serviceChargePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, totalPaise: 50_000 });
    expect(note.lines.map((l) => [l.position, l.invoicePosition, l.form, l.totalPaise])).toEqual([[1, 1, "LUMP_SUM", 50_000]]);
    const pdf = await PDFDocument.load(new Uint8Array(await getObject(note.file.storageKey)));
    expect(pdf.getTitle()).toBe("Credit note MCN00000001");

    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.recall" } })).toMatchObject({
      entityId: c.id,
      clientId: c.client.id,
      after: { stage: "PASSPORT_BACK", reason: "EMBASSY_DELAY", changedByHod: false, creditNoteNo: "MCN00000001", totalPaise: 50_000 },
    });
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.creditNote.issue" } })).toMatchObject({ after: { kind: "PART", reason: "RECALL" } });
  });

  it("issues no credit note when nothing goes back (every traveller a lump sum), and still moves the case", async () => {
    const { c, processor } = await atVendor({ lump: true });
    expect((await check(processor, c.caseNo)).body.defaultTotalPaise).toBe(0);
    const res = await recall(processor, c.caseNo, { reasonId: await recallReason("CLIENT_CANCELLED_TRIP") });
    expect(res.status).toBe(200);
    expect((res.body.case as CaseDto).recall).toMatchObject({ reason: "Client cancelled the trip", creditNote: null });
    expect((res.body.case as CaseDto).stage.code).toBe("PASSPORT_BACK");
    expect(await prisma.creditNote.count()).toBe(0);
  });

  it("follows the setting for when it's due back", async () => {
    const { c, processor } = await atVendor();
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const hod = await loginAs("riya@masti.test");
    expect((await hod.put("/api/visa/settings").send({ recallReturn: { afterDays: 3, at: "10:00" } })).status).toBe(200);
    const res = await recall(processor, c.caseNo);
    expect((res.body.case as CaseDto).dueAt).toBe(istDateTimeToUtc(addDays(istToday(), 3), "10:00").toISOString());
  });
});

describe("Change refund (HOD)", () => {
  it("lets the Visa HOD or the Head give back more, per traveller up to what they were charged", async () => {
    const { c } = await atVendor();
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const hod = await loginAs("riya@masti.test");
    expect((await check(hod, c.caseNo)).body.canChangeRefund).toBe(true);

    const below = await recall(hod, c.caseNo, { refunds: [{ position: 1, refundPaise: 10_000 }] });
    expect(below.status).toBe(400);
    expect(Object.keys(below.body.issues)).toEqual(["refunds"]);
    expect((await recall(hod, c.caseNo, { refunds: [{ position: 2, refundPaise: 200_001 }] })).status).toBe(400);
    expect((await recall(hod, c.caseNo, { refunds: [{ position: 9, refundPaise: 1 }] })).status).toBe(400);

    const res = await recall(hod, c.caseNo, { refunds: [{ position: 1, refundPaise: 130_000 }, { position: 2, refundPaise: 50_000 }] });
    expect(res.status).toBe(200);
    expect((res.body.case as CaseDto).recall!.creditNote).toMatchObject({ totalPaise: 180_000 });
    const note = await prisma.creditNote.findFirstOrThrow({ include: { lines: { orderBy: { position: "asc" } } } });
    expect(note).toMatchObject({ kind: "PART", serviceChargePaise: 0, cgstPaise: 0, sgstPaise: 0, totalPaise: 180_000 });
    expect(note.lines.map((l) => [l.invoicePosition, l.totalPaise])).toEqual([
      [1, 130_000],
      [2, 50_000],
    ]);
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.recall" } })).toMatchObject({ after: { changedByHod: true, totalPaise: 180_000 } });

    const head = await loginAs("vimal@masti.test");
    const other = await atVendor({ mobile: "98250 41235", clientName: "Sunil Shah" });
    expect((await recall(head, other.c.caseNo, { refunds: [{ position: 2, refundPaise: 200_000 }] })).status).toBe(200);
  });

  it("refuses a processor's larger refund", async () => {
    const { c, processor } = await atVendor();
    expect((await recall(processor, c.caseNo, { refunds: [{ position: 1, refundPaise: 60_000 }] })).status).toBe(403);
    // Sending the defaults is fine.
    expect((await recall(processor, c.caseNo, { refunds: [{ position: 1, refundPaise: 50_000 }, { position: 2, refundPaise: 0 }] })).status).toBe(200);
  });
});

describe("what is refused", () => {
  it("before dispatch, a second recall, a switched-off reason, a changed invoice, a stale page and a postponed case", async () => {
    await mastiReady();
    const waiting = await dispatchCase();
    expect((await recall(await neha(), waiting.caseNo, { invoiceNo: "MVI00000009" })).body.message).toMatch(/with the vendor/);

    const { c, processor } = await atVendor({ mobile: "98250 41235", clientName: "Sunil Shah" });
    const off = await prisma.recallReason.update({ where: { code: "DOCUMENTS_CHANGED" }, data: { isActive: false } });
    const offRes = await recall(processor, c.caseNo, { reasonId: off.id });
    expect(offRes.status).toBe(400);
    expect(Object.keys(offRes.body.issues)).toEqual(["reasonId"]);
    expect((await recall(processor, c.caseNo, { invoiceNo: "MVI00000009" })).body.details.code).toBe("RECALL_CHANGED");
    expect((await recall(processor, c.caseNo, { updatedAt: "2026-01-01T00:00:00.000Z" })).body.details.code).toBe("STALE");

    const seen = (await load(processor, c.caseNo)).updatedAt;
    await prisma.enquiry.update({ where: { id: c.id }, data: { status: "POSTPONED", reasonId: await reason("TRAVEL_DATES_MOVED"), resumeOn: toDbDate(addMonths(istToday(), 1)) } });
    expect((await recall(processor, c.caseNo, { updatedAt: seen })).body.message).toMatch(/postponed/);
    await prisma.enquiry.update({ where: { id: c.id }, data: { status: "OPEN", reasonId: null, resumeOn: null } });

    expect((await recall(processor, c.caseNo)).status).toBe(200);
    expect((await recall(processor, c.caseNo)).body.message).toMatch(/with the vendor/);
    expect(await prisma.creditNote.count()).toBe(1);
  });

  it("a cancelled invoice with no replacement yet; and after a recall the invoice can't be cancelled whole", async () => {
    const { c, processor } = await atVendor();
    const shown = (await processor.get(`/api/visa/cases/${c.caseNo}/invoice/cancel/check`)).body;
    const wrong = await prisma.creditNoteReason.findUniqueOrThrow({ where: { code: "WRONG_AMOUNT" } });
    const cancelBody = { invoiceNo: shown.invoiceNo, totalPaise: shown.preview.totalPaise, reasonId: wrong.id };
    expect((await processor.post(`/api/visa/cases/${c.caseNo}/invoice/cancel`).send(cancelBody)).status).toBe(200);
    expect((await recall(processor, c.caseNo)).body.message).toMatch(/no standing invoice/);

    const other = await atVendor({ mobile: "98250 41235", clientName: "Sunil Shah" });
    expect((await recall(other.processor, other.c.caseNo)).status).toBe(200);
    const again = (await other.processor.get(`/api/visa/cases/${other.c.caseNo}/invoice/cancel/check`)).body;
    const res = await other.processor.post(`/api/visa/cases/${other.c.caseNo}/invoice/cancel`).send({ invoiceNo: again.invoiceNo, totalPaise: again.preview.totalPaise, reasonId: wrong.id });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already gave part/);
  });

  it("an e-visa: it went in online", async () => {
    await mastiReady();
    const c = await dispatchCase();
    const { offeringId } = await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: c.id }, select: { offeringId: true } });
    await prisma.visaOffering.update({ where: { id: offeringId }, data: { vendorNeeded: false } });
    const processor = await neha();
    await makeInvoiceable(processor, c);
    await raise(processor, c.caseNo);
    const seen = (await load(processor, c.caseNo)).updatedAt;
    expect((await processor.post(`/api/visa/cases/${c.caseNo}/submit-online`).send({ updatedAt: seen })).status).toBe(200);
    expect((await recall(processor, c.caseNo)).body.message).toMatch(/went in online/);
  });
});

describe("who may take it back", () => {
  it("its processor, the Visa HOD and the Head; not other staff, view-only users or other departments", async () => {
    const { c } = await atVendor();
    await createUser({ name: "Kiran", email: "kiran@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
    await createUser({ name: "Hetal", email: "hetal@masti.test", departments: [{ code: "HOLIDAYS", access: "EDIT" }] });
    const seen = await load(await neha(), c.caseNo);
    for (const email of ["kiran@masti.test", "meena@masti.test", "hetal@masti.test"]) {
      expect((await recall(await loginAs(email), c.caseNo, { updatedAt: seen.updatedAt, invoiceNo: seen.invoice!.invoiceNo })).status).toBe(403);
    }
  });
});

describe("the database", () => {
  it("keeps the recall's who, when and why together, only for a docket file, and never credits more than invoiced", async () => {
    const { c } = await atVendor();
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "neha@masti.test" } });
    await expect(prisma.visaCase.update({ where: { enquiryId: c.id }, data: { recalledAt: new Date() } })).rejects.toThrow(/VisaCase_recall_together/);

    const online = await dispatchCase({ vendorId: (await prisma.vendor.findFirstOrThrow()).id, extra: { mobile: "98250 41236", clientName: "Kiran Bhatt" } });
    await expect(
      prisma.visaCase.update({ where: { enquiryId: online.id }, data: { recalledAt: new Date(), recalledById: user.id, recallReasonId: await recallReason() } }),
    ).rejects.toThrow(/VisaCase_recall_docket/);

    const invoice = await prisma.invoice.findFirstOrThrow({ where: { enquiryId: c.id } });
    const file = await prisma.caseFile.create({ data: { enquiryId: c.id, kind: "CREDIT_NOTE", storageKey: "x/1.pdf", fileName: "x1.pdf", sizeBytes: 1, pageCount: 1, uploadedById: user.id } });
    const recallCredit = await prisma.creditNoteReason.findUniqueOrThrow({ where: { code: "RECALL" } });
    const total = invoice.totalPaise + 1;
    await expect(
      prisma.creditNote.create({
        data: {
          creditNoteNo: "T1",
          invoiceId: invoice.id,
          enquiryId: c.id,
          kind: "PART",
          reasonId: recallCredit.id,
          issuedOn: invoice.issuedOn,
          issuedById: user.id,
          client: invoice.client!,
          company: invoice.company!,
          grossPaise: total,
          serviceChargePaise: 0,
          cgstPaise: 0,
          sgstPaise: 0,
          igstPaise: 0,
          totalPaise: total,
          fileId: file.id,
        },
      }),
    ).rejects.toThrow(/give back more than their invoice charged/);
  });
});

describe("races", () => {
  it("a recall that waited behind a postpone sees it and is refused", async () => {
    const { c, processor } = await atVendor();
    const seen = await load(processor, c.caseNo);
    const reasonId = await reason("TRAVEL_DATES_MOVED");
    const postpone = holdCaseLock(c.id, (tx) =>
      tx.enquiry.update({ where: { id: c.id }, data: { status: "POSTPONED", reasonId, resumeOn: toDbDate(addMonths(istToday(), 1)) } }),
    );
    await postpone.ready;
    const pending = recall(processor, c.caseNo, { updatedAt: seen.updatedAt, invoiceNo: seen.invoice!.invoiceNo, reasonId: await recallReason() }).then((r) => r);
    try {
      await untilWaitingOnLock();
    } finally {
      postpone.release();
    }
    await postpone.done;
    const res = await pending;
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/postponed/);
    expect((await prisma.visaCase.findUniqueOrThrow({ where: { enquiryId: c.id } })).recalledAt).toBeNull();
  });
});
