import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it } from "vitest";
import { addMonths, istToday, toDbDate } from "../src/lib/dates";
import { getObject } from "../src/lib/storage";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { dispatchCase, makeInvoiceable, mastiReady, saveCase, visaStaff, type Agent } from "./visaHelpers";

// The one additional invoice per file (docs/decisions/0011-visa-at-vendor.md Decision 7): "MVI…-A", extra charges from
// the list with the amount typed, no GST, at any step once the main invoice stands. A wrong one is cancelled with a
// credit note and corrected ("-B"), still 1 of 1.

beforeEach(async () => {
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

interface AdditionalDto {
  invoiceNo: string;
  totalPaise: number;
  gstPaise: number;
  charges: { name: string; amountPaise: number }[];
  replaces: string | null;
  cancelled: { creditNoteNo: string; reason: string; totalPaise: number } | null;
  file: { fileName: string };
}
interface CaseDto {
  updatedAt: string;
  invoice: { invoiceNo: string; cancelled: unknown } | null;
  additionalInvoice: AdditionalDto | null;
  earlierAdditionalInvoices: AdditionalDto[];
}
const load = async (agent: Agent, caseNo: string) => (await agent.get(`/api/visa/cases/${caseNo}`)).body.case as CaseDto;
const check = (agent: Agent, caseNo: string) => agent.get(`/api/visa/cases/${caseNo}/additional-invoice/check`);

async function raise(agent: Agent, caseNo: string) {
  const { quoteUpdatedAt, taxType, gstRatePercent, totalPaise } = (await agent.get(`/api/visa/cases/${caseNo}/invoice/check`)).body.preview;
  expect((await agent.post(`/api/visa/cases/${caseNo}/invoice`).send({ quoteUpdatedAt, taxType, gstRatePercent, totalPaise })).status).toBe(200);
}

/** Aarti's case at the Enquiry step with its main invoice raised. */
async function invoiced({ mobile = "98250 41234", clientName = "Rakesh Mehta" } = {}) {
  if (!(await prisma.user.findUnique({ where: { email: "vimal@masti.test" } }))) await mastiReady();
  const staff = await visaStaff();
  const saved = await saveCase(staff, { mobile, clientName });
  await makeInvoiceable(staff, saved, { clientName });
  await raise(staff, saved.caseNo);
  return { ...saved, staff };
}

type Charge = { code: string; amountPaise: number };
const URGENT_AND_PHOTOS: Charge[] = [
  { code: "URGENT_SUBMISSION", amountPaise: 150_000 },
  { code: "PHOTOS", amountPaise: 50_000 },
];

/** Raises the additional invoice for `charges`, against what the dialog shows (or `overrides`). */
async function addInvoice(agent: Agent, caseNo: string, charges: Charge[] = URGENT_AND_PHOTOS, overrides: Record<string, unknown> = {}) {
  // Read first: a request awaited inside another's .send(...) breaks supertest.
  const shown = (await check(agent, caseNo)).body as { mainInvoiceNo?: string };
  const ids = await Promise.all(charges.map((c) => prisma.extraCharge.findUniqueOrThrow({ where: { code: c.code } })));
  const body = {
    mainInvoiceNo: shown.mainInvoiceNo ?? "MVI00000001",
    charges: charges.map((c, i) => ({ chargeId: ids[i]!.id, amountPaise: c.amountPaise })),
    totalPaise: charges.reduce((n, c) => n + c.amountPaise, 0),
    ...overrides,
  };
  return agent.post(`/api/visa/cases/${caseNo}/additional-invoice`).send(body);
}

describe("the additional invoice (Decision 7)", () => {
  it("is MVI…-A with several charges, no GST, its own PDF and an audit row, and leaves the main invoice alone", async () => {
    const c = await invoiced();
    expect((await check(c.staff, c.caseNo)).body).toEqual({ mainInvoiceNo: "MVI00000001", alreadyRaised: null, replaces: null, invoiceNo: "MVI00000001-A", blockers: [] });

    const res = await addInvoice(c.staff, c.caseNo);
    expect(res.status).toBe(200);
    const after = res.body.case as CaseDto;
    expect(after.invoice!.invoiceNo).toBe("MVI00000001");
    expect(after.additionalInvoice).toMatchObject({
      invoiceNo: "MVI00000001-A",
      totalPaise: 200_000,
      gstPaise: 0,
      cancelled: null,
      charges: [
        { name: "Urgent submission", amountPaise: 150_000 },
        { name: "Photos", amountPaise: 50_000 },
      ],
    });
    expect(after.additionalInvoice!.file.fileName).toBe("MVI00000001-A_Mehta.pdf");

    const main = await prisma.invoice.findUniqueOrThrow({ where: { invoiceNo: "MVI00000001" } });
    const row = await prisma.invoice.findUniqueOrThrow({ where: { invoiceNo: "MVI00000001-A" }, include: { charges: true, lines: true, file: true } });
    expect(row).toMatchObject({ kind: "ADDITIONAL", grossPaise: 200_000, serviceChargePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, gstRateBp: 0, totalPaise: 200_000 });
    expect(row).toMatchObject({ placeOfSupply: main.placeOfSupply, taxType: main.taxType, sac: main.sac, processingSpeed: main.processingSpeed });
    expect(row.client).toEqual(main.client);
    expect(row.lines).toEqual([]);
    expect(row.charges.map((ch) => [ch.position, ch.name, ch.amountPaise])).toEqual([
      [1, "Urgent submission", 150_000],
      [2, "Photos", 50_000],
    ]);
    const pdf = await PDFDocument.load(new Uint8Array(await getObject(row.file.storageKey)));
    expect(pdf.getTitle()).toBe("Tax invoice MVI00000001-A");
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.additionalInvoice.raise" } })).toMatchObject({
      entityId: c.id,
      clientId: c.client.id,
      after: { invoiceNo: "MVI00000001-A", mainInvoiceNo: "MVI00000001", totalPaise: 200_000 },
    });
    // The invoice counter isn't used: the next main invoice is still MVI00000002.
    expect((await prisma.invoiceCounter.findUniqueOrThrow({ where: { id: 1 } })).lastValue).toBe(1);

    // The main invoice still freezes the quote, and the cancel dialog is about the main invoice.
    expect((await c.staff.get(`/api/visa/cases/${c.caseNo}/invoice/cancel/check`)).body.invoiceNo).toBe("MVI00000001");
  });

  it("is raised at Docket & dispatch and at At vendor too; the main invoice still decides dispatch", async () => {
    await mastiReady();
    const c = await dispatchCase();
    const neha = await loginAs("neha@masti.test");
    await makeInvoiceable(neha, c);
    await raise(neha, c.caseNo);
    expect((await addInvoice(neha, c.caseNo, [{ code: "PHOTOS", amountPaise: 50_000 }])).status).toBe(200);

    const seen = (await load(neha, c.caseNo)).updatedAt;
    expect((await neha.post(`/api/visa/cases/${c.caseNo}/docket`).send({ mode: "OWN", updatedAt: seen })).status).toBe(200);
    expect((await neha.get(`/api/visa/cases/${c.caseNo}`)).body.case.docket.cases[0].invoiceNo).toBe("MVI00000001");
    const courier = await prisma.courier.findUniqueOrThrow({ where: { code: "BY_HAND" } });
    expect((await neha.post(`/api/visa/cases/${c.caseNo}/dispatch`).send({ courierId: courier.id, awbNo: null, caseNos: [c.caseNo] })).status).toBe(200);

    // A recall gives back from the main invoice only.
    const recallReason = await prisma.recallReason.findUniqueOrThrow({ where: { code: "EMBASSY_DELAY" } });
    const atVendor = await load(neha, c.caseNo);
    const recalled = await neha.post(`/api/visa/cases/${c.caseNo}/recall`).send({ invoiceNo: "MVI00000001", reasonId: recallReason.id, updatedAt: atVendor.updatedAt });
    expect(recalled.status).toBe(200);
    const note = await prisma.creditNote.findFirstOrThrow({ include: { invoice: { select: { invoiceNo: true } } } });
    expect(note.invoice.invoiceNo).toBe("MVI00000001");
  });
});

/** "Cancel with a credit note" on `invoiceNo`, against what the dialog shows. */
async function cancel(agent: Agent, caseNo: string, invoiceNo?: string) {
  const shown = (await agent.get(`/api/visa/cases/${caseNo}/invoice/cancel/check${invoiceNo ? `?invoiceNo=${invoiceNo}` : ""}`)).body;
  const wrong = await prisma.creditNoteReason.findUniqueOrThrow({ where: { code: "WRONG_AMOUNT" } });
  return agent.post(`/api/visa/cases/${caseNo}/invoice/cancel`).send({ invoiceNo: shown.invoiceNo, totalPaise: shown.preview.totalPaise, reasonId: wrong.id });
}

describe("correcting it", () => {
  it("a credit note cancels it by its number, with no GST, and the correction is MVI…-B, still 1 of 1", async () => {
    const c = await invoiced();
    expect((await addInvoice(c.staff, c.caseNo)).status).toBe(200);

    const shown = (await c.staff.get(`/api/visa/cases/${c.caseNo}/invoice/cancel/check?invoiceNo=mvi00000001-a`)).body;
    expect(shown).toMatchObject({
      invoiceNo: "MVI00000001-A",
      alreadyCancelled: null,
      preview: { creditNoteNo: "MCN00000001", grossPaise: 200_000, serviceChargePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, totalPaise: 200_000 },
    });
    expect((await c.staff.get(`/api/visa/cases/${c.caseNo}/invoice/cancel/check?invoiceNo=MVI00000009`)).status).toBe(409);

    const res = await cancel(c.staff, c.caseNo, "MVI00000001-A");
    expect(res.status).toBe(200);
    const after = res.body.case as CaseDto;
    expect(after.additionalInvoice!.cancelled).toMatchObject({ creditNoteNo: "MCN00000001", reason: "Wrong amount", totalPaise: 200_000 });
    expect(after.invoice!.cancelled).toBeNull();

    const note = await prisma.creditNote.findUniqueOrThrow({
      where: { creditNoteNo: "MCN00000001" },
      include: { invoice: { select: { invoiceNo: true } }, lines: { orderBy: { position: "asc" } }, file: true },
    });
    expect(note).toMatchObject({ kind: "WHOLE", grossPaise: 200_000, serviceChargePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, totalPaise: 200_000 });
    expect(note.invoice.invoiceNo).toBe("MVI00000001-A");
    expect(note.lines.map((l) => [l.invoicePosition, l.name, l.form, l.lumpSumPaise, l.totalPaise])).toEqual([
      [1, "Urgent submission", "LUMP_SUM", 150_000, 150_000],
      [2, "Photos", "LUMP_SUM", 50_000, 50_000],
    ]);
    const pdf = await PDFDocument.load(new Uint8Array(await getObject(note.file.storageKey)));
    expect(pdf.getTitle()).toBe("Credit note MCN00000001");
    expect((await cancel(c.staff, c.caseNo, "MVI00000001-A")).body.message).toMatch(/already cancelled by MCN00000001/);

    // The correction: the next letter, replacing the cancelled one.
    expect((await check(c.staff, c.caseNo)).body).toMatchObject({ alreadyRaised: null, replaces: "MVI00000001-A", invoiceNo: "MVI00000001-B" });
    const fixed = await addInvoice(c.staff, c.caseNo, [{ code: "URGENT_SUBMISSION", amountPaise: 120_000 }]);
    expect(fixed.status).toBe(200);
    const corrected = fixed.body.case as CaseDto;
    expect(corrected.additionalInvoice).toMatchObject({ invoiceNo: "MVI00000001-B", totalPaise: 120_000, replaces: "MVI00000001-A", cancelled: null });
    expect(corrected.earlierAdditionalInvoices.map((e) => [e.invoiceNo, e.cancelled?.creditNoteNo])).toEqual([["MVI00000001-A", "MCN00000001"]]);
    const a = await prisma.invoice.findUniqueOrThrow({ where: { invoiceNo: "MVI00000001-A" } });
    const b = await prisma.invoice.findUniqueOrThrow({ where: { invoiceNo: "MVI00000001-B" }, include: { file: true } });
    expect(b).toMatchObject({ kind: "ADDITIONAL", replacesId: a.id, totalPaise: 120_000 });
    expect((await PDFDocument.load(new Uint8Array(await getObject(b.file.storageKey)))).getTitle()).toBe("Tax invoice MVI00000001-B");
    expect(
      await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.additionalInvoice.raise", after: { path: ["invoiceNo"], equals: "MVI00000001-B" } } }),
    ).toMatchObject({ after: { replaces: "MVI00000001-A" } });

    const again = await addInvoice(c.staff, c.caseNo);
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/MVI00000001-B: 1 of 1 used/);

    // The main invoice is still its own: cancelling it leaves the additional one standing.
    expect((await c.staff.get(`/api/visa/cases/${c.caseNo}/invoice/cancel/check`)).body).toMatchObject({ invoiceNo: "MVI00000001", alreadyCancelled: null });
    const mainCancelled = (await cancel(c.staff, c.caseNo)).body.case as CaseDto;
    expect(mainCancelled.invoice!.cancelled).not.toBeNull();
    expect(mainCancelled.additionalInvoice).toMatchObject({ invoiceNo: "MVI00000001-B", cancelled: null });
  });

  it("only by those who may raise it", async () => {
    const c = await invoiced();
    expect((await addInvoice(c.staff, c.caseNo)).status).toBe(200);
    await createUser({ name: "Kiran", email: "kiran@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    const wrong = await prisma.creditNoteReason.findUniqueOrThrow({ where: { code: "WRONG_AMOUNT" } });
    const kiran = await loginAs("kiran@masti.test");
    expect((await kiran.post(`/api/visa/cases/${c.caseNo}/invoice/cancel`).send({ invoiceNo: "MVI00000001-A", totalPaise: 200_000, reasonId: wrong.id })).status).toBe(403);
    expect(await prisma.creditNote.count()).toBe(0);
  });

  it("on a cancelled case only the Visa HOD or the Head cancels it, and no -B follows (0006 amendment 15)", async () => {
    const c = await invoiced();
    expect((await addInvoice(c.staff, c.caseNo)).status).toBe(200);
    const { updatedAt } = (await c.staff.get(`/api/visa/cases/${c.caseNo}`)).body.case;
    const reasonId = (await prisma.enquiryReason.findUniqueOrThrow({ where: { code: "TRIP_CANCELLED" } })).id;
    expect((await c.staff.post(`/api/enquiries/${c.caseNo}/cancel`).send({ reasonId, updatedAt })).status).toBe(200);

    expect((await cancel(c.staff, c.caseNo, "MVI00000001-A")).status).toBe(403);
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const hod = await loginAs("riya@masti.test");
    const res = await cancel(hod, c.caseNo, "MVI00000001-A");
    expect(res.status).toBe(200);
    expect((res.body.case as CaseDto).additionalInvoice!.cancelled).toMatchObject({ creditNoteNo: "MCN00000001", totalPaise: 200_000 });
    const corrected = await addInvoice(hod, c.caseNo);
    expect(corrected.status).toBe(409);
    expect(corrected.body.message).toMatch(/closed/);
  });
});

describe("what is refused", () => {
  it("no main invoice, or a cancelled one not yet replaced", async () => {
    await mastiReady();
    const staff = await visaStaff();
    const bare = await saveCase(staff, { mobile: "98250 41299", clientName: "Kiran Shah" });
    expect((await check(staff, bare.caseNo)).status).toBe(409);
    expect((await addInvoice(staff, bare.caseNo)).body.message).toMatch(/Raise the invoice first/);

    const c = await invoiced();
    const shown = (await c.staff.get(`/api/visa/cases/${c.caseNo}/invoice/cancel/check`)).body;
    const wrong = await prisma.creditNoteReason.findUniqueOrThrow({ where: { code: "WRONG_AMOUNT" } });
    expect((await c.staff.post(`/api/visa/cases/${c.caseNo}/invoice/cancel`).send({ invoiceNo: shown.invoiceNo, totalPaise: shown.preview.totalPaise, reasonId: wrong.id })).status).toBe(200);
    expect((await addInvoice(c.staff, c.caseNo, URGENT_AND_PHOTOS, { mainInvoiceNo: "MVI00000001" })).body.message).toMatch(/Raise the invoice first/);
  });

  it("a second one, bad charges and amounts, a changed total or main invoice, and Masti's details missing", async () => {
    const c = await invoiced();
    const off = await prisma.extraCharge.update({ where: { code: "COURIER_EXTRA" }, data: { isActive: false } });
    const field = async (body: Record<string, unknown>) => {
      const res = await addInvoice(c.staff, c.caseNo, URGENT_AND_PHOTOS, body);
      expect(res.status).toBe(400);
      return Object.keys(res.body.issues ?? {});
    };
    expect(await field({ charges: [{ chargeId: off.id, amountPaise: 10_000 }], totalPaise: 10_000 })).toEqual(["charges"]);
    expect(await field({ charges: [], totalPaise: 0 })).toEqual(["charges"]);
    const urgent = await prisma.extraCharge.findUniqueOrThrow({ where: { code: "URGENT_SUBMISSION" } });
    expect(await field({ charges: Array.from({ length: 11 }, () => ({ chargeId: urgent.id, amountPaise: 100 })), totalPaise: 1_100 })).toEqual(["charges"]);
    expect(await field({ charges: [{ chargeId: urgent.id, amountPaise: 0 }], totalPaise: 0 })).toEqual(["charges"]);
    expect(await field({ charges: [{ chargeId: urgent.id, amountPaise: 100_000_001 }], totalPaise: 100_000_001 })).toEqual(["charges"]);

    expect((await addInvoice(c.staff, c.caseNo, URGENT_AND_PHOTOS, { totalPaise: 1 })).body.details.code).toBe("ADDITIONAL_CHANGED");
    expect((await addInvoice(c.staff, c.caseNo, URGENT_AND_PHOTOS, { mainInvoiceNo: "MVI00000009" })).body.details.code).toBe("ADDITIONAL_CHANGED");

    const details = await prisma.setting.findUniqueOrThrow({ where: { key: "company.details" } });
    await prisma.setting.update({ where: { key: "company.details" }, data: { value: { ...(details.value as object), gstin: null } } });
    const blocked = await addInvoice(c.staff, c.caseNo);
    expect(blocked.body.details.code).toBe("ADDITIONAL_BLOCKED");
    await prisma.setting.update({ where: { key: "company.details" }, data: { value: details.value as object } });
    expect(await prisma.invoice.count({ where: { kind: "ADDITIONAL" } })).toBe(0);

    expect((await addInvoice(c.staff, c.caseNo)).status).toBe(200);
    const again = await addInvoice(c.staff, c.caseNo);
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/MVI00000001-A: 1 of 1 used/);
    expect((await check(c.staff, c.caseNo)).body.alreadyRaised).toBe("MVI00000001-A");
  });

  it("a postponed case", async () => {
    const c = await invoiced();
    const reasonId = (await prisma.enquiryReason.findUniqueOrThrow({ where: { code: "TRAVEL_DATES_MOVED" } })).id;
    await prisma.enquiry.update({ where: { id: c.id }, data: { status: "POSTPONED", reasonId, resumeOn: toDbDate(addMonths(istToday(), 1)) } });
    expect((await addInvoice(c.staff, c.caseNo)).body.message).toMatch(/postponed/);
  });
});

describe("who may raise it", () => {
  it("the case's owner, the Visa HOD and the Head; not other staff, view-only users or other departments", async () => {
    const c = await invoiced();
    await createUser({ name: "Kiran", email: "kiran@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
    await createUser({ name: "Hetal", email: "hetal@masti.test", departments: [{ code: "HOLIDAYS", access: "EDIT" }] });
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    for (const email of ["kiran@masti.test", "meena@masti.test", "hetal@masti.test"]) {
      expect((await addInvoice(await loginAs(email), c.caseNo)).status).toBe(403);
    }
    expect((await addInvoice(await loginAs("riya@masti.test"), c.caseNo)).status).toBe(200);

    const other = await invoiced({ mobile: "98250 41235", clientName: "Sunil Shah" });
    expect((await addInvoice(await loginAs("vimal@masti.test"), other.caseNo)).status).toBe(200);
  });
});

describe("the database", () => {
  it("one original additional invoice per case, never GST on it, charges only on it, and never edited", async () => {
    const c = await invoiced();
    expect((await addInvoice(c.staff, c.caseNo)).status).toBe(200);
    const main = await prisma.invoice.findUniqueOrThrow({ where: { invoiceNo: "MVI00000001" } });
    const add = await prisma.invoice.findUniqueOrThrow({ where: { invoiceNo: "MVI00000001-A" }, include: { charges: true } });
    let n = 0;
    const copy = async (data: Record<string, unknown>) => {
      n++;
      const file = await prisma.caseFile.create({ data: { enquiryId: c.id, kind: "INVOICE", storageKey: `x/${n}.pdf`, fileName: `x${n}.pdf`, sizeBytes: 1, pageCount: 1, uploadedById: add.issuedById } });
      const { id: _id, charges: _c, replacesId: _r, client, company, terms, ...rest } = add;
      return prisma.invoice.create({ data: { ...rest, client: client!, company: company!, terms: terms!, invoiceNo: `TEST${n}`, fileId: file.id, ...data } });
    };
    await expect(copy({})).rejects.toThrow(/Invoice_one_original_additional_per_case/);
    await expect(copy({ kind: "ADDITIONAL", replacesId: null, serviceChargePaise: 100, totalPaise: add.totalPaise + 100, enquiryId: (await invoiced({ mobile: "98250 41236", clientName: "Kiran Bhatt" })).id })).rejects.toThrow(
      /Invoice_additional_no_gst/,
    );

    const urgent = await prisma.extraCharge.findUniqueOrThrow({ where: { code: "URGENT_SUBMISSION" } });
    await expect(prisma.invoiceCharge.create({ data: { invoiceId: main.id, position: 1, chargeId: urgent.id, name: "x", amountPaise: 100 } })).rejects.toThrow(
      /only on an additional invoice/,
    );
    await expect(prisma.invoiceCharge.updateMany({ where: { invoiceId: add.id }, data: { amountPaise: 1 } })).rejects.toThrow(/never edited/);
  });

  it("a correction replaces a cancelled invoice of its own kind", async () => {
    const c = await invoiced();
    expect((await addInvoice(c.staff, c.caseNo)).status).toBe(200);
    expect((await cancel(c.staff, c.caseNo)).status).toBe(200);
    const main = await prisma.invoice.findUniqueOrThrow({ where: { invoiceNo: "MVI00000001" } });
    const add = await prisma.invoice.findUniqueOrThrow({ where: { invoiceNo: "MVI00000001-A" } });
    const file = await prisma.caseFile.create({ data: { enquiryId: c.id, kind: "INVOICE", storageKey: "x/kind.pdf", fileName: "x.pdf", sizeBytes: 1, pageCount: 1, uploadedById: add.issuedById } });
    const { id: _id, client, company, terms, ...rest } = add;
    await expect(
      prisma.invoice.create({ data: { ...rest, client: client!, company: company!, terms: terms!, invoiceNo: "TEST-KIND", fileId: file.id, replacesId: main.id } }),
    ).rejects.toThrow(/same kind/);
  });
});
