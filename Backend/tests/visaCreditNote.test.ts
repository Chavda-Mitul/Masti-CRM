import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it } from "vitest";
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
      /CreditNote_one_whole_per_invoice/,
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
