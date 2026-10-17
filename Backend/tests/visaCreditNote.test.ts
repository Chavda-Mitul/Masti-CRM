import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it } from "vitest";
import { addMonths, istToday, toDbDate } from "../src/lib/dates";
import { getObject } from "../src/lib/storage";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { dispatchCase, makeInvoiceable, mastiReady, saveCase, visaStaff, type Agent } from "./visaHelpers";

// Correcting a wrong invoice (docs/decisions/0011-visa-at-vendor.md Decision 5): a WHOLE credit note cancels it,
// giving back everything it charged, its GST included; the invoice itself is never changed.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

interface CaseDto {
  invoice: {
    invoiceNo: string;
    totalPaise: number;
    cancelled: { creditNoteNo: string; issuedOn: string; reason: string; totalPaise: number; issuedBy: { name: string }; file: { id: string; fileName: string } } | null;
  } | null;
  docket: { cases: { caseNo: string; invoiceNo: string | null }[] } | null;
}
const load = async (agent: Agent, caseNo: string) => (await agent.get(`/api/visa/cases/${caseNo}`)).body.case as CaseDto;
const reasonId = async (code = "WRONG_AMOUNT") => (await prisma.creditNoteReason.findUniqueOrThrow({ where: { code } })).id;
const check = (agent: Agent, caseNo: string) => agent.get(`/api/visa/cases/${caseNo}/invoice/cancel/check`);

/** Raises the case's invoice with what the Raise dialog shows. */
async function raise(agent: Agent, caseNo: string) {
  const { quoteUpdatedAt, taxType, gstRatePercent, totalPaise } = (await agent.get(`/api/visa/cases/${caseNo}/invoice/check`)).body.preview;
  const res = await agent.post(`/api/visa/cases/${caseNo}/invoice`).send({ quoteUpdatedAt, taxType, gstRatePercent, totalPaise });
  expect(res.status).toBe(200);
  return res.body.case as CaseDto;
}

/** Aarti's case at the Enquiry step with its invoice raised (Gujarat: CGST + SGST, or `state`). */
async function invoiced({ state = "24", mobile = "98250 41234", clientName = "Rakesh Mehta" } = {}) {
  const staff = await visaStaff();
  const saved = await saveCase(staff, { mobile, clientName });
  await makeInvoiceable(staff, saved, { state, clientName });
  const invoice = (await raise(staff, saved.caseNo)).invoice!;
  return { ...saved, staff, invoice };
}

/** Presses Confirm with the invoice and total the dialog shows (or `body`'s), for `code`'s reason. */
async function cancel(agent: Agent, caseNo: string, body: { invoiceNo?: string; totalPaise?: number; reasonId?: number } = {}) {
  const shown = (await check(agent, caseNo)).body as { invoiceNo: string; preview: { totalPaise: number } };
  const reason = body.reasonId ?? (await reasonId());
  return agent.post(`/api/visa/cases/${caseNo}/invoice/cancel`).send({ invoiceNo: shown.invoiceNo, totalPaise: shown.preview.totalPaise, ...body, reasonId: reason });
}

describe("cancelling a wrong invoice (Decision 5)", () => {
  it("issues MCN + 8 digits giving back every amount, the CGST and SGST included, with a stored PDF and an audit row", async () => {
    await mastiReady();
    const c = await invoiced();
    const before = await prisma.invoice.findUniqueOrThrow({ where: { invoiceNo: c.invoice.invoiceNo }, include: { lines: true } });

    const look = (await check(c.staff, c.caseNo)).body;
    expect(look).toMatchObject({ invoiceNo: "MVI00000001", alreadyCancelled: null, blockers: [] });
    expect(look.preview).toEqual({
      creditNoteNo: "MCN00000001",
      taxType: "INTRA_STATE",
      grossPaise: 541_000,
      serviceChargePaise: 50_000,
      cgstPaise: 4_500,
      sgstPaise: 4_500,
      igstPaise: 0,
      totalPaise: 600_000,
    });

    const res = await cancel(c.staff, c.caseNo);
    expect(res.status).toBe(200);
    const after = (res.body.case as CaseDto).invoice!;
    expect(after.invoiceNo).toBe("MVI00000001");
    expect(after.cancelled).toMatchObject({ creditNoteNo: "MCN00000001", reason: "Wrong amount", totalPaise: 600_000 });
    expect(after.cancelled!.file.fileName).toBe("MCN00000001_Mehta.pdf");

    const note = await prisma.creditNote.findUniqueOrThrow({ where: { creditNoteNo: "MCN00000001" }, include: { lines: { orderBy: { position: "asc" } }, file: true } });
    expect(note).toMatchObject({ kind: "WHOLE", invoiceId: before.id, grossPaise: 541_000, serviceChargePaise: 50_000, cgstPaise: 4_500, sgstPaise: 4_500, igstPaise: 0, totalPaise: 600_000 });
    expect(note.lines.map((l) => [l.position, l.invoicePosition, l.name, l.totalPaise])).toEqual([
      [1, 1, "Rakesh Mehta", 341_000],
      [2, 2, "Aarav Test", 200_000],
    ]);
    expect(note.client).toEqual(before.client);
    expect(note.file).toMatchObject({ kind: "CREDIT_NOTE", pageCount: 1 });
    const pdf = await PDFDocument.load(new Uint8Array(await getObject(note.file.storageKey)));
    expect(pdf.getTitle()).toBe("Credit note MCN00000001");

    // The invoice itself is untouched.
    expect(await prisma.invoice.findUniqueOrThrow({ where: { id: before.id }, include: { lines: true } })).toEqual(before);
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.creditNote.issue" } })).toMatchObject({
      entityId: c.id,
      clientId: c.client.id,
      after: { creditNoteNo: "MCN00000001", kind: "WHOLE", invoiceNo: "MVI00000001", reason: "WRONG_AMOUNT", totalPaise: 600_000 },
    });
  });

  it("gives back the IGST of a client in another state", async () => {
    await mastiReady();
    const c = await invoiced({ state: "27" });
    expect((await cancel(c.staff, c.caseNo)).status).toBe(200);
    expect(await prisma.creditNote.findFirstOrThrow()).toMatchObject({ cgstPaise: 0, sgstPaise: 0, igstPaise: 9_000, totalPaise: 600_000 });
  });

  it("numbers credit notes in their own series, from the setting, without gaps", async () => {
    await mastiReady();
    const a = await invoiced();
    const b = await invoiced({ mobile: "98250 41235", clientName: "Sunil Shah" });
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const hod = await loginAs("riya@masti.test");
    expect((await hod.put("/api/visa/settings").send({ creditNote: { prefix: "CN", digits: 5, startAt: 40 } })).status).toBe(200);
    expect((await hod.put("/api/visa/settings").send({ creditNote: { prefix: "cn", digits: 5, startAt: 40 } })).status).toBe(400);

    const [ra, rb] = await Promise.all([cancel(a.staff, a.caseNo), cancel(b.staff, b.caseNo)]);
    expect([ra.status, rb.status]).toEqual([200, 200]);
    const numbers = [ra.body.case.invoice.cancelled.creditNoteNo, rb.body.case.invoice.cancelled.creditNoteNo].sort();
    expect(numbers).toEqual(["CN00040", "CN00041"]);
    // The invoice series is untouched.
    expect((await prisma.invoiceCounter.findUniqueOrThrow({ where: { id: 1 } })).lastValue).toBe(2);
  });

  it("works once the file is with the vendor (Step 5)", async () => {
    await mastiReady();
    const c = await dispatchCase();
    const neha = await loginAs("neha@masti.test");
    await makeInvoiceable(neha, c);
    await raise(neha, c.caseNo);
    const seen = (await neha.get(`/api/visa/cases/${c.caseNo}`)).body.case.updatedAt;
    expect((await neha.post(`/api/visa/cases/${c.caseNo}/docket`).send({ mode: "OWN", updatedAt: seen })).status).toBe(200);
    const courier = await prisma.courier.findUniqueOrThrow({ where: { code: "BY_HAND" } });
    expect((await neha.post(`/api/visa/cases/${c.caseNo}/dispatch`).send({ courierId: courier.id, awbNo: null, caseNos: [c.caseNo] })).status).toBe(200);

    const res = await cancel(neha, c.caseNo, { reasonId: await reasonId("WRONG_TRAVELLER_DETAILS") });
    expect(res.status).toBe(200);
    expect((res.body.case as CaseDto).invoice!.cancelled).toMatchObject({ reason: "Wrong traveller details" });
  });

  it("works at Docket & dispatch, and the cancelled invoice stops counting: the file can't leave", async () => {
    await mastiReady();
    const c = await dispatchCase();
    const neha = await loginAs("neha@masti.test");
    await makeInvoiceable(neha, c);
    await raise(neha, c.caseNo);
    const seen = (await neha.get(`/api/visa/cases/${c.caseNo}`)).body.case.updatedAt;
    expect((await neha.post(`/api/visa/cases/${c.caseNo}/docket`).send({ mode: "OWN", updatedAt: seen })).status).toBe(200);
    expect((await load(neha, c.caseNo)).docket!.cases[0]!.invoiceNo).toBe("MVI00000001");

    expect((await cancel(neha, c.caseNo, { reasonId: await reasonId("WRONG_CLIENT_DETAILS") })).status).toBe(200);
    // At Docket & dispatch: the file has no invoice any more, so it can't leave.
    expect((await load(neha, c.caseNo)).docket!.cases[0]!.invoiceNo).toBeNull();
    const blocked = await neha.get(`/api/visa/cases/${c.caseNo}/dispatch/check`);
    expect(blocked.body.blockers.map((b: { kind: string }) => b.kind)).toEqual(["INVOICE"]);
  });
});

describe("what is refused", () => {
  it("no invoice, a second cancellation, a switched-off reason, another invoice or total; nothing is used up", async () => {
    await mastiReady();
    const staff = await visaStaff();
    const bare = await saveCase(staff, { mobile: "98250 41299", clientName: "Kiran Shah" });
    expect((await check(staff, bare.caseNo)).status).toBe(409);
    expect((await staff.post(`/api/visa/cases/${bare.caseNo}/invoice/cancel`).send({ invoiceNo: "MVI00000001", totalPaise: 0, reasonId: await reasonId() })).status).toBe(409);

    const c = await invoiced();
    const off = await prisma.creditNoteReason.update({ where: { code: "CLIENT_CANCELLED" }, data: { isActive: false } });
    const offRes = await cancel(c.staff, c.caseNo, { reasonId: off.id });
    expect(offRes.status).toBe(400);
    expect(Object.keys(offRes.body.issues)).toEqual(["reasonId"]);
    expect((await cancel(c.staff, c.caseNo, { totalPaise: 1 })).body.details.code).toBe("CREDIT_NOTE_CHANGED");
    expect((await cancel(c.staff, c.caseNo, { invoiceNo: "MVI00000009" })).body.details.code).toBe("CREDIT_NOTE_CHANGED");
    expect(await prisma.creditNote.count()).toBe(0);
    expect(await prisma.creditNoteCounter.count()).toBe(0);

    expect((await cancel(c.staff, c.caseNo)).status).toBe(200);
    const again = await cancel(c.staff, c.caseNo);
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/already cancelled by MCN00000001/);
    expect((await check(c.staff, c.caseNo)).body.alreadyCancelled).toBe("MCN00000001");
  });

  it("while Masti's details can't be printed", async () => {
    await mastiReady();
    const c = await invoiced();
    await prisma.setting.update({ where: { key: "company.details" }, data: { value: { ...((await prisma.setting.findUniqueOrThrow({ where: { key: "company.details" } })).value as object), gstin: null } } });
    const res = await cancel(c.staff, c.caseNo);
    expect(res.status).toBe(409);
    expect(res.body.details.code).toBe("CREDIT_NOTE_BLOCKED");
    expect(res.body.details.blockers[0]).toMatchObject({ kind: "COMPANY", items: expect.arrayContaining(["GSTIN"]) });
  });
});

describe("who may cancel it", () => {
  it("the case's owner, the Visa HOD and the Head; not other staff, view-only users or other departments", async () => {
    await mastiReady();
    const c = await invoiced();
    await createUser({ name: "Kiran", email: "kiran@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
    await createUser({ name: "Hetal", email: "hetal@masti.test", departments: [{ code: "HOLIDAYS", access: "EDIT" }] });
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const body = { invoiceNo: c.invoice.invoiceNo, totalPaise: c.invoice.totalPaise, reasonId: await reasonId() };

    for (const email of ["kiran@masti.test", "meena@masti.test", "hetal@masti.test"]) {
      expect((await (await loginAs(email)).post(`/api/visa/cases/${c.caseNo}/invoice/cancel`).send(body)).status).toBe(403);
    }
    const hod = await (await loginAs("riya@masti.test")).post(`/api/visa/cases/${c.caseNo}/invoice/cancel`).send(body);
    expect(hod.status).toBe(200);
    expect((hod.body.case as CaseDto).invoice!.cancelled!.issuedBy.name).toBe("Riya");

    const other = await invoiced({ mobile: "98250 41235", clientName: "Sunil Shah" });
    const head = await loginAs("vimal@masti.test");
    expect((await cancel(head, other.caseNo)).status).toBe(200);
  });
});

describe("on a cancelled case (0006 amendment 15)", () => {
  /** "Postpone or cancel" → Cancel the case, reason Trip cancelled. Reads first: never await inside .send(...). */
  async function cancelCase(agent: Agent, caseNo: string) {
    const updatedAt = (await agent.get(`/api/visa/cases/${caseNo}`)).body.case.updatedAt;
    const reason = (await prisma.enquiryReason.findUniqueOrThrow({ where: { code: "TRIP_CANCELLED" } })).id;
    return agent.post(`/api/enquiries/${caseNo}/cancel`).send({ reasonId: reason, updatedAt });
  }

  it("only the Visa HOD or the Head cancels its invoice, a refund: no corrected invoice follows", async () => {
    await mastiReady();
    const c = await invoiced();
    expect((await check(c.staff, c.caseNo)).body.hodOnly).toBe(false);
    expect((await cancelCase(c.staff, c.caseNo)).status).toBe(200);
    expect((await check(c.staff, c.caseNo)).body.hodOnly).toBe(true);

    const clientCancelled = await reasonId("CLIENT_CANCELLED");
    const own = await cancel(c.staff, c.caseNo, { reasonId: clientCancelled });
    expect(own.status).toBe(403);
    expect(own.body.message).toMatch(/only the Visa HOD or the Head/);
    expect(await prisma.creditNote.count()).toBe(0);

    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const hod = await loginAs("riya@masti.test");
    const res = await cancel(hod, c.caseNo, { reasonId: clientCancelled });
    expect(res.status).toBe(200);
    expect(res.body.case.status).toBe("CANCELLED");
    expect((res.body.case as CaseDto).invoice!.cancelled).toMatchObject({ creditNoteNo: "MCN00000001", reason: "Client cancelled", issuedBy: { name: "Riya" } });

    // Nothing is raised again on a cancelled case: no corrected invoice, and the quote stays as it is.
    const { quoteUpdatedAt, taxType, gstRatePercent, totalPaise } = (await hod.get(`/api/visa/cases/${c.caseNo}/invoice/check`)).body.preview;
    const raised = await hod.post(`/api/visa/cases/${c.caseNo}/invoice`).send({ quoteUpdatedAt, taxType, gstRatePercent, totalPaise });
    expect(raised.status).toBe(409);
    expect(raised.body.message).toMatch(/closed/);
    const requoted = await requote(hod, c, 70_000);
    expect(requoted.status).toBe(409);
    expect(requoted.body.message).toMatch(/closed/);
  });

  it("a postponed case is resumed first, and a closed one keeps its invoice", async () => {
    await mastiReady();
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const hod = await loginAs("riya@masti.test");
    const c = await invoiced();
    const later = (await prisma.enquiryReason.findUniqueOrThrow({ where: { code: "TRAVEL_DATES_MOVED" } })).id;
    await prisma.enquiry.update({ where: { id: c.id }, data: { status: "POSTPONED", reasonId: later, resumeOn: toDbDate(addMonths(istToday(), 1)) } });
    expect((await cancel(hod, c.caseNo)).body.message).toMatch(/Resume it first/);
    await prisma.enquiry.update({ where: { id: c.id }, data: { status: "CLOSED", reasonId: null, resumeOn: null, dueAt: null } });
    const closed = await cancel(hod, c.caseNo);
    expect(closed.status).toBe(409);
    expect(closed.body.message).toMatch(/closed/);
    expect(await prisma.creditNote.count()).toBe(0);
  });
});

/** Saves the quote again with a new service charge, as the case's quote token says. */
async function requote(agent: Agent, c: { id: string; caseNo: string }, serviceChargePaise: number) {
  const updatedAt = (await agent.get(`/api/visa/cases/${c.caseNo}`)).body.case.quote.updatedAt;
  const travellers = await prisma.visaCaseTraveller.findMany({ where: { caseId: c.id }, orderBy: { position: "asc" } });
  const speed = await prisma.processingSpeed.findUniqueOrThrow({ where: { code: "NORMAL" } });
  return agent.put(`/api/visa/cases/${c.caseNo}/quote`).send({
    processingSpeedId: speed.id,
    serviceChargePaise,
    lines: travellers.map((t) => ({ travellerId: t.id, form: "LUMP_SUM", lumpSumPaise: 300_000 })),
    updatedAt,
  });
}

interface ChainDto {
  invoice: { invoiceNo: string; totalPaise: number; replaces: string | null; cancelled: { creditNoteNo: string } | null } | null;
  earlierInvoices: { invoiceNo: string; replaces: string | null; cancelled: { creditNoteNo: string } | null }[];
}

describe("the replacement invoice (Decision 5, M37)", () => {
  it("reopens the quote once the invoice is cancelled; the corrected invoice replaces it and freezes the quote again", async () => {
    await mastiReady();
    const c = await invoiced();
    expect((await requote(c.staff, c, 70_000)).body.message).toMatch(/MVI00000001 is raised/);

    expect((await cancel(c.staff, c.caseNo)).status).toBe(200);
    expect((await requote(c.staff, c, 70_000)).status).toBe(200);
    const look = (await c.staff.get(`/api/visa/cases/${c.caseNo}/invoice/check`)).body;
    expect(look).toMatchObject({ alreadyRaised: null, replaces: "MVI00000001", preview: { invoiceNo: "MVI00000002" } });

    const after = (await raise(c.staff, c.caseNo)) as unknown as ChainDto;
    expect(after.invoice).toMatchObject({ invoiceNo: "MVI00000002", replaces: "MVI00000001", cancelled: null });
    expect(after.earlierInvoices).toEqual([expect.objectContaining({ invoiceNo: "MVI00000001", replaces: null, cancelled: expect.objectContaining({ creditNoteNo: "MCN00000001" }) })]);
    const first = await prisma.invoice.findUniqueOrThrow({ where: { invoiceNo: "MVI00000001" } });
    const second = await prisma.invoice.findUniqueOrThrow({ where: { invoiceNo: "MVI00000002" }, include: { file: true } });
    expect(second.replacesId).toBe(first.id);
    expect(second.serviceChargePaise).toBe(70_000);
    const pdf = await PDFDocument.load(new Uint8Array(await getObject(second.file.storageKey)));
    expect(pdf.getTitle()).toBe("Tax invoice MVI00000002");
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.invoice.raise", after: { path: ["invoiceNo"], equals: "MVI00000002" } } })).toMatchObject({
      after: { replaces: "MVI00000001" },
    });

    expect((await requote(c.staff, c, 80_000)).body.message).toMatch(/MVI00000002 is raised/);
    const again = await c.staff.post(`/api/visa/cases/${c.caseNo}/invoice`).send({ quoteUpdatedAt: new Date().toISOString(), taxType: "INTRA_STATE", gstRatePercent: 18, totalPaise: 1 });
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/already has invoice MVI00000002/);
  });

  it("can be cancelled and replaced again: one chain, only its last invoice stands", async () => {
    await mastiReady();
    const c = await invoiced();
    await cancel(c.staff, c.caseNo);
    await requote(c.staff, c, 60_000);
    await raise(c.staff, c.caseNo);
    expect((await cancel(c.staff, c.caseNo, { reasonId: await reasonId("WRONG_CLIENT_DETAILS") })).status).toBe(200);
    await requote(c.staff, c, 65_000);
    const after = (await raise(c.staff, c.caseNo)) as unknown as ChainDto;
    expect(after.invoice).toMatchObject({ invoiceNo: "MVI00000003", replaces: "MVI00000002" });
    expect(after.earlierInvoices.map((i) => [i.invoiceNo, i.cancelled?.creditNoteNo])).toEqual([
      ["MVI00000002", "MCN00000002"],
      ["MVI00000001", "MCN00000001"],
    ]);
  });

  it("after the file has gone to the vendor: the quote stays shut until the invoice is cancelled, then the replacement unblocks", async () => {
    await mastiReady();
    const c = await dispatchCase();
    const neha = await loginAs("neha@masti.test");
    await makeInvoiceable(neha, c);
    await raise(neha, c.caseNo);
    const seen = (await neha.get(`/api/visa/cases/${c.caseNo}`)).body.case.updatedAt;
    expect((await neha.post(`/api/visa/cases/${c.caseNo}/docket`).send({ mode: "OWN", updatedAt: seen })).status).toBe(200);

    // At Docket & dispatch: cancelled, so the file can't leave until the corrected invoice is raised.
    await cancel(neha, c.caseNo);
    expect((await requote(neha, c, 55_000)).status).toBe(200);
    await raise(neha, c.caseNo);
    expect((await neha.get(`/api/visa/cases/${c.caseNo}/dispatch/check`)).body.blockers).toEqual([]);
    const courier = await prisma.courier.findUniqueOrThrow({ where: { code: "BY_HAND" } });
    expect((await neha.post(`/api/visa/cases/${c.caseNo}/dispatch`).send({ courierId: courier.id, awbNo: null, caseNos: [c.caseNo] })).status).toBe(200);

    // At At vendor: the quote is shut while the invoice stands, and reopens once it's cancelled.
    expect((await requote(neha, c, 57_000)).body.message).toMatch(/gone to the vendor/);
    expect((await cancel(neha, c.caseNo)).status).toBe(200);
    expect((await requote(neha, c, 57_000)).status).toBe(200);
    const after = (await raise(neha, c.caseNo)) as unknown as ChainDto;
    expect(after.invoice).toMatchObject({ invoiceNo: "MVI00000003", replaces: "MVI00000002" });
  });

  it("the database keeps one original per case, and replaces only a cancelled invoice of the same case", async () => {
    await mastiReady();
    const a = await invoiced();
    const b = await invoiced({ mobile: "98250 41235", clientName: "Sunil Shah" });
    const invA = await prisma.invoice.findUniqueOrThrow({ where: { invoiceNo: a.invoice.invoiceNo }, include: { lines: true } });
    const invB = await prisma.invoice.findUniqueOrThrow({ where: { invoiceNo: b.invoice.invoiceNo } });
    let n = 0;
    const copy = async (replacesId: string | null) => {
      n++;
      const file = await prisma.caseFile.create({ data: { enquiryId: a.id, kind: "INVOICE", storageKey: `x/${n}.pdf`, fileName: `x${n}.pdf`, sizeBytes: 1, pageCount: 1, uploadedById: invA.issuedById } });
      const { id: _id, lines: _lines, replacesId: _r, client, company, terms, ...rest } = invA;
      return prisma.invoice.create({
        data: { ...rest, client: client!, company: company!, terms: terms!, invoiceNo: `TEST${n}`, fileId: file.id, replacesId },
      });
    };
    await expect(copy(null)).rejects.toThrow(/Invoice_one_original_per_case/);
    await expect(copy(invA.id)).rejects.toThrow(/once a credit note has cancelled it/);
    await expect(copy(invB.id)).rejects.toThrow(/same case/);
  });
});

describe("the database", () => {
  it("never changes a credit note, makes a WHOLE one match its invoice, allows one per invoice, and no GST on a PART one", async () => {
    await mastiReady();
    const c = await invoiced();
    expect((await cancel(c.staff, c.caseNo)).status).toBe(200);
    const note = await prisma.creditNote.findFirstOrThrow({ include: { lines: true } });
    await expect(prisma.creditNote.update({ where: { id: note.id }, data: { totalPaise: 1 } })).rejects.toThrow(/never edited/);
    await expect(prisma.creditNote.delete({ where: { id: note.id } })).rejects.toThrow(/never edited/);
    await expect(prisma.creditNoteLine.deleteMany({ where: { creditNoteId: note.id } })).rejects.toThrow(/never edited/);

    const fileRow = (n: number) =>
      prisma.caseFile.create({ data: { enquiryId: c.id, kind: "CREDIT_NOTE", storageKey: `x/${n}.pdf`, fileName: `x${n}.pdf`, sizeBytes: 1, pageCount: 1, uploadedById: note.issuedById } });
    const base = {
      invoiceId: note.invoiceId,
      enquiryId: c.id,
      reasonId: note.reasonId,
      issuedOn: note.issuedOn,
      issuedById: note.issuedById,
      client: note.client!,
      company: note.company!,
      grossPaise: note.grossPaise,
      serviceChargePaise: note.serviceChargePaise,
      cgstPaise: note.cgstPaise,
      sgstPaise: note.sgstPaise,
      igstPaise: note.igstPaise,
      totalPaise: note.totalPaise,
    };
    await expect(prisma.creditNote.create({ data: { ...base, creditNoteNo: "T1", kind: "WHOLE", fileId: (await fileRow(1)).id } })).rejects.toThrow(
      // The "never more than invoiced" trigger runs first; the one-whole-per-invoice index backs it up.
      /CreditNote_one_whole_per_invoice|give back more than their invoice charged/,
    );

    const other = await invoiced({ mobile: "98250 41235", clientName: "Sunil Shah" });
    const otherInvoice = await prisma.invoice.findUniqueOrThrow({ where: { invoiceNo: other.invoice.invoiceNo } });
    const wrong = { ...base, invoiceId: otherInvoice.id, enquiryId: other.id, grossPaise: base.grossPaise - 100, totalPaise: base.totalPaise - 100 };
    await expect(prisma.creditNote.create({ data: { ...wrong, creditNoteNo: "T2", kind: "WHOLE", fileId: (await fileRow(2)).id } })).rejects.toThrow(
      /exactly what its invoice charged/,
    );
    await expect(
      prisma.creditNote.create({ data: { ...base, invoiceId: otherInvoice.id, creditNoteNo: "T3", kind: "PART", fileId: (await fileRow(3)).id } }),
    ).rejects.toThrow(/its invoice's case|CreditNote_part_has_no_gst/);
    const part = { ...base, invoiceId: otherInvoice.id, enquiryId: other.id, cgstPaise: 0, sgstPaise: 0, totalPaise: base.grossPaise + base.serviceChargePaise };
    await expect(prisma.creditNote.create({ data: { ...part, cgstPaise: 4_500, totalPaise: part.totalPaise + 4_500, creditNoteNo: "T4", kind: "PART", fileId: (await fileRow(4)).id } })).rejects.toThrow(
      /CreditNote_part_has_no_gst/,
    );
  });
});
