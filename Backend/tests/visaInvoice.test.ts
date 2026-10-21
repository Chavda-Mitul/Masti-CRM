import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addMonths, istToday, toDbDate } from "../src/lib/dates";
import { bucket, getObject, s3 } from "../src/lib/storage";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { createUser, loginAs, prisma, resetDb } from "./helpers";
import { dispatchCase, makeInvoiceable, mastiReady, saveCase, visaStaff, type Agent } from "./visaHelpers";

// Raising the visa tax invoice (docs/decisions/0009-visa-invoice.md): from the quote, numbered in Masti's series, GST
// on the service charge, a stored PDF, and never edited.

/** The bucket is MinIO for real; `whileStoring` runs while an invoice PDF is being stored, before it is. */
const uploads = vi.hoisted(() => ({ whileStoring: null as ((key: string) => Promise<void>) | null }));
vi.mock("../src/lib/storage", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/storage")>();
  return {
    ...real,
    putObject: async (key: string, body: Buffer, contentType: string) => {
      if (key.includes("/invoice/")) await uploads.whileStoring?.(key);
      return real.putObject(key, body, contentType);
    },
  };
});

beforeEach(async () => {
  uploads.whileStoring = null;
  await resetDb();
  await seedVisaMasters(prisma);
  await seedEnquiryMasters(prisma);
});

interface CaseDto {
  updatedAt: string;
  travellers: { id: string }[];
  quote: { updatedAt: string; totalPaise: number } | null;
  invoice: { invoiceNo: string; taxType: string; gstPaise: number; totalPaise: number; file: { id: string; fileName: string } } | null;
  docket: { cases: { caseNo: string; invoiceNo: string | null }[] } | null;
}
const load = async (agent: Agent, caseNo: string) => (await agent.get(`/api/visa/cases/${caseNo}`)).body.case as CaseDto;

/**
 * A case at the Enquiry step, Aarti's, ready to invoice: its client complete (in `state`), both travellers named, and
 * a quote: the adult itemised (500 + 800 + 2,110), the child a lump sum of 2,000, and a service charge of 500.
 */
async function invoiceableCase({ state = "24", mobile = "98250 41234", clientName = "Rakesh Mehta", service = 50_000 } = {}) {
  const staff = await visaStaff();
  const saved = await saveCase(staff, { mobile, clientName });
  return { ...saved, staff, ...(await makeInvoiceable(staff, saved, { state, clientName, service })) };
}

const check = (agent: Agent, caseNo: string) => agent.get(`/api/visa/cases/${caseNo}/invoice/check`);

interface Shown {
  quoteUpdatedAt: string;
  taxType: string;
  gstRatePercent: number;
  totalPaise: number;
}
/** What the Raise dialog showed and sends back: its preview's quote, rate, tax type and total. */
async function shown(agent: Agent, caseNo: string): Promise<Shown> {
  const { preview } = (await check(agent, caseNo)).body as { preview: Shown | null };
  if (preview) return { quoteUpdatedAt: preview.quoteUpdatedAt, taxType: preview.taxType, gstRatePercent: preview.gstRatePercent, totalPaise: preview.totalPaise };
  // Blocked, so no preview: the press is refused for what blocks it.
  const quote = (await load(agent, caseNo)).quote;
  return { quoteUpdatedAt: quote?.updatedAt ?? new Date().toISOString(), taxType: "INTRA_STATE", gstRatePercent: 18, totalPaise: quote?.totalPaise ?? 0 };
}

/** Presses Raise with what the dialog shows now, or `seen`, what it showed earlier. */
async function raise(agent: Agent, caseNo: string, seen?: Shown) {
  const body = seen ?? (await shown(agent, caseNo));
  return agent.post(`/api/visa/cases/${caseNo}/invoice`).send(body);
}

describe("raising the invoice", () => {
  it("makes MVI + 8 digits from the quote, with CGST + SGST for a Gujarat client, a stored PDF, and an audit row", async () => {
    await mastiReady();
    const c = await invoiceableCase();
    const preview = (await check(c.staff, c.caseNo)).body;
    expect(preview.blockers).toEqual([]);
    expect(preview.preview).toMatchObject({ invoiceNo: "MVI00000001", taxType: "INTRA_STATE", cgstPaise: 4_500, sgstPaise: 4_500, igstPaise: 0, totalPaise: 600_000 });

    const res = await raise(c.staff, c.caseNo);
    expect(res.status).toBe(200);
    const invoice = (res.body.case as CaseDto).invoice!;
    expect(invoice).toMatchObject({ invoiceNo: "MVI00000001", taxType: "INTRA_STATE", gstPaise: 9_000, totalPaise: 600_000 });
    expect(invoice.file.fileName).toBe("MVI00000001_Mehta.pdf");

    const row = await prisma.invoice.findUniqueOrThrow({ where: { invoiceNo: "MVI00000001" }, include: { lines: { orderBy: { position: "asc" } }, file: true } });
    expect(row).toMatchObject({
      grossPaise: 541_000,
      serviceChargePaise: 50_000,
      cgstPaise: 4_500,
      sgstPaise: 4_500,
      igstPaise: 0,
      totalPaise: 600_000,
      placeOfSupply: "24",
      sac: "998559",
      gstRateBp: 1800,
      processingSpeed: "Normal",
    });
    expect(row.lines.map((l) => [l.position, l.name, l.description, l.totalPaise])).toEqual([
      [1, "Rakesh Mehta", "FRANCE(TOURIST)(NORMAL)", 341_000],
      [2, "Aarav Test", "FRANCE(TOURIST)(NORMAL)", 200_000],
    ]);
    expect(row.file).toMatchObject({ kind: "INVOICE", pageCount: 1 });

    const stored = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: row.file.storageKey }));
    expect(stored.ContentType).toBe("application/pdf");
    const pdf = await PDFDocument.load(new Uint8Array(await getObject(row.file.storageKey)));
    expect(pdf.getPageCount()).toBe(1);
    expect(pdf.getTitle()).toBe("Tax invoice MVI00000001");

    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "visa.invoice.raise" } })).toMatchObject({
      entityId: c.id,
      clientId: c.client.id,
      after: { invoiceNo: "MVI00000001", totalPaise: 600_000 },
    });
  });

  it("charges IGST to a client in another state, and no GST without a service charge", async () => {
    await mastiReady();
    const maharashtra = await invoiceableCase({ state: "27" });
    expect((await raise(maharashtra.staff, maharashtra.caseNo)).body.case.invoice).toMatchObject({ taxType: "INTER_STATE", gstPaise: 9_000 });
    const row = await prisma.invoice.findFirstOrThrow({ where: { enquiryId: maharashtra.id } });
    expect(row).toMatchObject({ cgstPaise: 0, sgstPaise: 0, igstPaise: 9_000 });

    const lumpOnly = await invoiceableCase({ mobile: "98250 41299", clientName: "Kiran Shah", service: 0 });
    const res = await raise(lumpOnly.staff, lumpOnly.caseNo);
    expect(res.body.case.invoice).toMatchObject({ gstPaise: 0, totalPaise: 541_000 });
  });

  it("follows the starting number, runs on, jumps forward when it's raised, and never reuses a number", async () => {
    await mastiReady();
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    const hod = await loginAs("riya@masti.test");
    const setting = (await hod.get("/api/visa/settings")).body.settings.invoice;
    await hod.put("/api/visa/settings").send({ invoice: { ...setting, startAt: 1379 } });

    const a = await invoiceableCase();
    expect((await raise(a.staff, a.caseNo)).body.case.invoice.invoiceNo).toBe("MVI00001379");
    const b = await invoiceableCase({ mobile: "98250 41299", clientName: "Kiran Shah" });
    expect((await raise(b.staff, b.caseNo)).body.case.invoice.invoiceNo).toBe("MVI00001380");

    await hod.put("/api/visa/settings").send({ invoice: { ...setting, startAt: 2000 } });
    const c = await invoiceableCase({ mobile: "98250 41298", clientName: "Mohan Patel" });
    expect((await raise(c.staff, c.caseNo)).body.case.invoice.invoiceNo).toBe("MVI00002000");

    await hod.put("/api/visa/settings").send({ invoice: { ...setting, startAt: 5 } });
    const d = await invoiceableCase({ mobile: "98250 41297", clientName: "Asha Desai" });
    expect((await raise(d.staff, d.caseNo)).body.case.invoice.invoiceNo).toBe("MVI00002001");
  });

  it("is refused for a second time, a quote that changed meanwhile, and uses no number when refused", async () => {
    await mastiReady();
    const c = await invoiceableCase();
    const seen = await shown(c.staff, c.caseNo);
    // The quote changes after the dialog opened.
    const travellers = c.travellers;
    const speed = await prisma.processingSpeed.findUniqueOrThrow({ where: { code: "NORMAL" } });
    await c.staff.put(`/api/visa/cases/${c.caseNo}/quote`).send({
      processingSpeedId: speed.id,
      serviceChargePaise: 60_000,
      lines: [
        { travellerId: travellers[0]!.id, form: "LUMP_SUM", lumpSumPaise: 100_000 },
        { travellerId: travellers[1]!.id, form: "LUMP_SUM", lumpSumPaise: 100_000 },
      ],
      updatedAt: seen.quoteUpdatedAt,
    });
    const stale = await raise(c.staff, c.caseNo, seen);
    expect(stale.status).toBe(409);
    expect(stale.body.details).toMatchObject({ code: "STALE" });
    expect(await prisma.invoiceCounter.count()).toBe(0);

    expect((await raise(c.staff, c.caseNo)).status).toBe(200);
    const again = await raise(c.staff, c.caseNo);
    expect(again.status).toBe(409);
    expect(again.body.message).toBe("This case already has invoice MVI00000001.");
  });

  it("is refused if the GST rate changed after the dialog showed it, and uses no number", async () => {
    await mastiReady();
    const c = await invoiceableCase();
    const seen = await shown(c.staff, c.caseNo);
    expect(seen).toMatchObject({ gstRatePercent: 18, totalPaise: 600_000 });
    const value = { prefix: "MVI", digits: 8, startAt: 1, gstRatePercent: 12, sac: "998559" };
    await prisma.setting.upsert({ where: { key: "visa.invoice" }, update: { value }, create: { key: "visa.invoice", value } });

    const changed = await raise(c.staff, c.caseNo, seen);
    expect(changed.status).toBe(409);
    expect(changed.body.details).toMatchObject({ code: "INVOICE_CHANGED" });
    expect(await prisma.invoiceCounter.count()).toBe(0);
    expect(await prisma.invoice.count()).toBe(0);

    // The dialog loads the new amounts, and those are raised.
    const now = await shown(c.staff, c.caseNo);
    expect(now).toMatchObject({ gstRatePercent: 12, totalPaise: 600_000 - 9_000 + 6_000 });
    const res = await raise(c.staff, c.caseNo, now);
    expect(res.status).toBe(200);
    expect((res.body.case as CaseDto).invoice).toMatchObject({ gstPaise: 6_000, totalPaise: 597_000 });
  });

  it("is refused if the client's state changed after the dialog showed it (CGST + SGST became IGST)", async () => {
    await mastiReady();
    const c = await invoiceableCase();
    const seen = await shown(c.staff, c.caseNo);
    expect(seen.taxType).toBe("INTRA_STATE");
    await prisma.client.update({ where: { id: c.client.id }, data: { stateCode: "27" } });

    const changed = await raise(c.staff, c.caseNo, seen);
    expect(changed.status).toBe(409);
    expect(changed.body.details).toMatchObject({ code: "INVOICE_CHANGED" });
    expect(await prisma.invoice.count()).toBe(0);
    expect((await raise(c.staff, c.caseNo)).body.case.invoice).toMatchObject({ taxType: "INTER_STATE" });
  });

  it("is refused if the request leaves out what the dialog showed", async () => {
    await mastiReady();
    const c = await invoiceableCase();
    const { quoteUpdatedAt } = await shown(c.staff, c.caseNo);
    expect((await c.staff.post(`/api/visa/cases/${c.caseNo}/invoice`).send({ quoteUpdatedAt })).status).toBe(400);
    expect(await prisma.invoice.count()).toBe(0);
  });
});

describe("what blocks it", () => {
  const blockersOf = async (agent: Agent, caseNo: string) => (await check(agent, caseNo)).body.blockers as { kind: string; items: string[] }[];

  it("Masti's missing details, the client's, an unnamed traveller, a missing quote, and non-English names", async () => {
    const staff = await visaStaff();
    const saved = await saveCase(staff);
    let blockers = await blockersOf(staff, saved.caseNo);
    expect(blockers.map((b) => b.kind)).toEqual(["QUOTE", "TRAVELLERS", "CLIENT", "COMPANY"]);
    expect(blockers.find((b) => b.kind === "TRAVELLERS")!.items).toEqual(["Adult 1", "Child 1"]);
    expect(blockers.find((b) => b.kind === "CLIENT")!.items).toEqual(["Address", "City", "State"]);
    expect(blockers.find((b) => b.kind === "COMPANY")!.items).toEqual(["PAN", "GSTIN", "State", "Bank details", "Logo", "Signature"]);

    const refused = await raise(staff, saved.caseNo);
    expect(refused.status).toBe(409);
    expect(refused.body.details.code).toBe("INVOICE_BLOCKED");

    await mastiReady();
    const c = await invoiceableCase({ mobile: "98250 41299", clientName: "Kiran Shah" });
    expect(await blockersOf(c.staff, c.caseNo)).toEqual([]);
    await prisma.visaCaseTraveller.update({ where: { id: c.travellers[1]!.id }, data: { name: "આરવ" } });
    blockers = await blockersOf(c.staff, c.caseNo);
    expect(blockers).toEqual([{ kind: "NOT_ENGLISH", label: expect.any(String), items: ["Child 1's name"] }]);
    expect((await raise(c.staff, c.caseNo)).body.details.code).toBe("INVOICE_BLOCKED");
    expect(await prisma.invoice.count()).toBe(0);
  });

  it("a quote where every amount is ₹0: there's nothing to invoice (decided 21 Oct 2026)", async () => {
    await mastiReady();
    const c = await invoiceableCase();
    const speed = await prisma.processingSpeed.findUniqueOrThrow({ where: { code: "NORMAL" } });
    const updatedAt = (await c.staff.get(`/api/visa/cases/${c.caseNo}`)).body.case.quote.updatedAt as string;
    const lines = c.travellers.map((t) => ({ travellerId: t.id, form: "LUMP_SUM", lumpSumPaise: 0 }));
    expect((await c.staff.put(`/api/visa/cases/${c.caseNo}/quote`).send({ processingSpeedId: speed.id, serviceChargePaise: 0, lines, updatedAt })).status).toBe(200);

    expect(await blockersOf(c.staff, c.caseNo)).toEqual([{ kind: "QUOTE", label: "There's nothing to invoice: every amount is ₹0.", items: [] }]);
    expect((await raise(c.staff, c.caseNo)).body.details.code).toBe("INVOICE_BLOCKED");
    expect(await prisma.invoice.count()).toBe(0);
  });

  it("non-English text anywhere it prints: Masti's phones, email and bank, the terms, and the name of whoever raises it", async () => {
    const head = await mastiReady();
    const c = await invoiceableCase();
    const bank = { accountName: "Test Travels", accountNo: "123456789012", bankName: "Test Bank", branch: "વરાછા", ifsc: "TEST0000123" };
    expect((await head.put("/api/company/details").send({ phone2: "૯૮૨૫૦ ૧૨૩૪૫", bank })).status).toBe(200);
    expect((await head.put("/api/company/invoice-terms").send({ lines: ["Fees once paid are not refundable.", "વિઝા ફી પરત નથી."] })).status).toBe(200);
    await prisma.user.update({ where: { email: "aarti@masti.test" }, data: { name: "આરતી" } });

    const blockers = await blockersOf(c.staff, c.caseNo);
    expect(blockers).toEqual([
      {
        kind: "NOT_ENGLISH",
        label: expect.any(String),
        items: ["Masti's 24/7 phone", "Masti's bank branch", "Invoice terms, line 2", "Your name (printed as Prepared by)"],
      },
    ]);
    expect((await raise(c.staff, c.caseNo)).body.details.code).toBe("INVOICE_BLOCKED");
    expect(await prisma.invoice.count()).toBe(0);
  });
});

describe("who and when", () => {
  it("the owner, the Visa HOD and the Head may raise; others may not; view-only users can open the PDF", async () => {
    await mastiReady();
    await createUser({ name: "Riya", email: "riya@masti.test", departments: [{ code: "VISA", role: "HOD" }] });
    await createUser({ name: "Meena", email: "meena@masti.test", departments: [{ code: "VISA", access: "VIEW" }] });
    await createUser({ name: "Neha Joshi", email: "neha@masti.test", departments: [{ code: "VISA", access: "EDIT" }] });
    const [hod, viewer, other] = [await loginAs("riya@masti.test"), await loginAs("meena@masti.test"), await loginAs("neha@masti.test")];

    const c = await invoiceableCase();
    const seen = await shown(hod, c.caseNo);
    expect((await raise(viewer, c.caseNo, seen)).status).toBe(403);
    expect((await raise(other, c.caseNo, seen)).status).toBe(403);
    const ok = await raise(hod, c.caseNo, seen);
    expect(ok.status).toBe(200);

    const fileId = (ok.body.case as CaseDto).invoice!.file.id;
    const link = await viewer.get(`/api/visa/cases/${c.caseNo}/files/${fileId}/link`);
    expect(link.status).toBe(200);
    expect(link.body.url).toContain("X-Amz-Signature");
    expect(await prisma.auditLog.count({ where: { action: "visa.file.open" } })).toBe(1);
  });

  it("not once the file has gone to the vendor, nor while postponed", async () => {
    await mastiReady();
    const c = await invoiceableCase();
    const reasonId = (await prisma.enquiryReason.findUniqueOrThrow({ where: { code: "TRAVEL_DATES_MOVED" } })).id;
    await prisma.enquiry.update({ where: { id: c.id }, data: { status: "POSTPONED", reasonId, resumeOn: toDbDate(addMonths(istToday(), 1)) } });
    expect((await raise(c.staff, c.caseNo)).body.message).toMatch(/postponed/);

    await prisma.enquiry.update({ where: { id: c.id }, data: { status: "OPEN", reasonId: null, resumeOn: null } });
    const atVendor = await prisma.departmentStage.findFirstOrThrow({ where: { code: "AT_VENDOR" } });
    await prisma.enquiry.update({ where: { id: c.id }, data: { stageId: atVendor.id } });
    expect((await raise(c.staff, c.caseNo)).status).toBe(409);
  });
});

describe("the Docket card's Invoice column (component 4)", () => {
  it("shows each case's invoice number, or none yet, on every case in the docket; never on the sticker", async () => {
    await mastiReady();
    const mehta = await dispatchCase();
    const shah = await dispatchCase({ vendorId: mehta.vendor.id, extra: { mobile: "98250 41235", clientName: "Sunil Shah" } });
    const neha = await loginAs("neha@masti.test");
    for (const c of [mehta, shah]) {
      const { updatedAt } = await load(neha, c.caseNo);
      expect((await neha.post(`/api/visa/cases/${c.caseNo}/docket`).send({ mode: "GROUP", updatedAt })).status).toBe(200);
    }
    const column = async (caseNo: string) => (await load(neha, caseNo)).docket!.cases.map((r) => [r.caseNo, r.invoiceNo]);
    expect(await column(mehta.caseNo)).toEqual([
      [mehta.caseNo, null],
      [shah.caseNo, null],
    ]);

    await makeInvoiceable(neha, mehta);
    expect((await raise(neha, mehta.caseNo)).status).toBe(200);
    for (const c of [mehta, shah]) {
      expect(await column(c.caseNo)).toEqual([
        [mehta.caseNo, "MVI00000001"],
        [shah.caseNo, null],
      ]);
    }
    const label = (await neha.get(`/api/visa/cases/${shah.caseNo}/sticker`)).body.sticker as { cases: object[] };
    expect(label.cases[0]).not.toHaveProperty("invoiceNo");
  });
});

describe("never edited", () => {
  it("the database refuses changes, the quote freezes, and the client's later edits don't touch it", async () => {
    await mastiReady();
    const c = await invoiceableCase();
    await raise(c.staff, c.caseNo);

    await expect(prisma.$executeRawUnsafe(`UPDATE "Invoice" SET "totalPaise" = 1`)).rejects.toThrow(/never edited/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "Invoice"`)).rejects.toThrow(/never edited/);
    await expect(prisma.$executeRawUnsafe(`UPDATE "InvoiceLine" SET "name" = 'x'`)).rejects.toThrow(/never edited/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "InvoiceLine"`)).rejects.toThrow(/never edited/);

    const current = await load(c.staff, c.caseNo);
    const speed = await prisma.processingSpeed.findUniqueOrThrow({ where: { code: "NORMAL" } });
    const frozen = await c.staff.put(`/api/visa/cases/${c.caseNo}/quote`).send({
      processingSpeedId: speed.id,
      serviceChargePaise: 1,
      lines: c.travellers.map((t) => ({ travellerId: t.id, form: "LUMP_SUM", lumpSumPaise: 1 })),
      updatedAt: current.quote!.updatedAt,
    });
    expect(frozen.status).toBe(409);
    expect(frozen.body.message).toBe("Invoice MVI00000001 is raised, so the quote can't change.");

    await prisma.client.update({ where: { id: c.client.id }, data: { name: "Someone Else", city: "Mumbai" } });
    const row = await prisma.invoice.findFirstOrThrow({ where: { enquiryId: c.id } });
    expect(row.client).toMatchObject({ name: "Rakesh Mehta", addressLines: ["12, Test Society", "Surat"] });
  });
});

describe("taking turns", () => {
  it("two raises of one case at once give one invoice; two cases at once get consecutive numbers", async () => {
    await mastiReady();
    const a = await invoiceableCase();
    const seen = await shown(a.staff, a.caseNo);
    const results = await Promise.all([raise(a.staff, a.caseNo, seen), raise(a.staff, a.caseNo, seen)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.invoice.count()).toBe(1);

    const b = await invoiceableCase({ mobile: "98250 41299", clientName: "Kiran Shah" });
    const c = await invoiceableCase({ mobile: "98250 41298", clientName: "Mohan Patel" });
    const [rb, rc] = await Promise.all([raise(b.staff, b.caseNo), raise(c.staff, c.caseNo)]);
    expect([rb.body.case.invoice.invoiceNo, rc.body.case.invoice.invoiceNo].sort()).toEqual(["MVI00000002", "MVI00000003"]);
  });

  it("the counter isn't held while the PDF is stored; a number taken meanwhile is made again with the next one", async () => {
    await mastiReady();
    const c = await invoiceableCase();
    const seen = await shown(c.staff, c.caseNo);
    const stored: { key: string; counterLocked: boolean }[] = [];
    uploads.whileStoring = async (key) => {
      // NOWAIT fails at once if this raise already held the counter's row.
      const counterLocked = await prisma
        .$transaction(async (tx) => tx.$queryRaw`SELECT "id" FROM "InvoiceCounter" FOR UPDATE NOWAIT`)
        .then(() => false, () => true);
      // The first time, another raise takes MVI00000001 while this PDF is being stored.
      if (stored.length === 0) await prisma.invoiceCounter.create({ data: { id: 1, lastValue: 1 } });
      stored.push({ key, counterLocked });
    };

    const res = await raise(c.staff, c.caseNo, seen);
    expect(res.status).toBe(200);
    expect((res.body.case as CaseDto).invoice!.invoiceNo).toBe("MVI00000002");
    expect(stored.map((s) => s.counterLocked)).toEqual([false, false]);
    // The PDF made with the taken number is removed; the one kept carries MVI00000002.
    await expect(s3.send(new HeadObjectCommand({ Bucket: bucket, Key: stored[0]!.key }))).rejects.toThrow();
    const row = await prisma.invoice.findUniqueOrThrow({ where: { invoiceNo: "MVI00000002" }, include: { file: true } });
    expect(row.file.storageKey).toBe(stored[1]!.key);
    expect((await prisma.invoiceCounter.findUniqueOrThrow({ where: { id: 1 } })).lastValue).toBe(2);
  });
});
