import { randomUUID } from "node:crypto";
import type { Prisma } from "../../../generated/prisma/client";
import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { assertFresh } from "../../lib/changes";
import { istToday, toDbDate } from "../../lib/dates";
import { conflict, HttpError, notFound } from "../../lib/httpError";
import { gstPaise, lineTotalPaise, quoteTotals, rateBasisPoints, splitIntraState } from "../../lib/money";
import { deleteObject, getObject, putObject } from "../../lib/storage";
import { GST_STATES } from "../../lib/shared.schemas";
import { getClientSettings } from "../clients/clients.settings";
import { readinessOf } from "../clients/readiness";
import { currentCompanyImages } from "../company/company.service";
import { getCompanyDetails, getInvoiceTerms, invoiceMissing } from "../company/company.settings";
import { assertCanSeeEnquiry } from "../enquiries/visibility";
import type { Actor, UserWithDepartments } from "../users/user";
import { loadCase, lockCase, QUOTING } from "./caseLock";
import { renderInvoicePdf, unprintable, type InvoiceImages, type InvoiceView } from "./invoicePdf";
import type { RaiseInvoiceInput } from "./visa.schemas";
import { getVisaCaseById } from "./visa.service";
import { getVisaSettings } from "./visa.settings";
import { familyName, travellerLabel } from "./visaCase";

// The visa tax invoice (docs/decisions/0009-visa-invoice.md): raised from the case's quote by its owner, the Visa HOD or
// the Head, numbered in Masti's series, with a PDF in Masti's layout stored privately, and never edited (triggers in
// the database refuse it). A raised invoice can't be undone yet (Decision 9), so nothing is raised while anything is
// missing: invoiceBlockers lists it first.

const caseInclude = {
  client: true,
  invoice: { select: { invoiceNo: true } },
  visa: {
    include: {
      offering: { include: { country: true, visaType: true } },
      travellers: { orderBy: { position: "asc" }, include: { member: { select: { name: true } } } },
      quote: { include: { lines: true, processingSpeed: true } },
    },
  },
} satisfies Prisma.EnquiryInclude;

/** Everything an invoice is made from, read together (inside the transaction when raising). */
async function gather(enquiryId: string, db: Db) {
  const enquiry = await db.enquiry.findUniqueOrThrow({ where: { id: enquiryId }, include: caseInclude });
  const [company, terms, settings, clientSettings, images] = await Promise.all([
    getCompanyDetails(db),
    getInvoiceTerms(db),
    getVisaSettings(db),
    getClientSettings(db),
    currentCompanyImages(),
  ]);
  return { enquiry, visa: enquiry.visa!, company, terms, invoiceSetting: settings.invoice, clientSettings, images };
}

type Gathered = Awaited<ReturnType<typeof gather>>;

export type InvoiceBlockerKind = "QUOTE" | "TRAVELLERS" | "CLIENT" | "COMPANY" | "NOT_ENGLISH";
export interface InvoiceBlocker {
  kind: InvoiceBlockerKind;
  label: string;
  items: string[];
}

/** A traveller's name as the invoice prints it: the linked family member's, or the one it was filed under. */
const travellerName = (t: Gathered["visa"]["travellers"][number]) => t.member?.name ?? t.name;

/** "FRANCE(TOURIST)(NORMAL)(SINGLE)": country, visa type, processing speed and entry, as on Masti's invoices. */
function description(g: Gathered) {
  const parts = [g.visa.offering.country.name, g.visa.offering.visaType.name, g.visa.quote?.processingSpeed.name, g.visa.entryType];
  return parts
    .filter((p): p is string => !!p)
    .map((p, i) => (i === 0 ? p : `(${p})`))
    .join("")
    .toUpperCase();
}

/**
 * What still stands in the way of raising the invoice, grouped for the dialog. Empty means it can be raised. The
 * client's state is always needed (it decides CGST + SGST or IGST), whatever the readiness setting says. `preparedBy` is
 * the name of whoever would raise it: the invoice prints it.
 */
function blockersOf(g: Gathered, preparedBy: string): InvoiceBlocker[] {
  const blockers: InvoiceBlocker[] = [];
  const adults = g.visa.travellers.filter((t) => !t.isChild).length;
  const label = (t: Gathered["visa"]["travellers"][number]) => travellerLabel(t, adults);

  const quote = g.visa.quote;
  if (!quote) blockers.push({ kind: "QUOTE", label: "Add the quote first.", items: [] });
  else {
    const missing = g.visa.travellers.filter((t) => !quote.lines.some((l) => l.travellerId === t.id)).map(label);
    if (missing.length) blockers.push({ kind: "QUOTE", label: "Give every traveller an amount in the quote.", items: missing });
  }

  const unnamed = g.visa.travellers.filter((t) => !travellerName(t)).map(label);
  if (unnamed.length) blockers.push({ kind: "TRAVELLERS", label: "Name every traveller: the invoice lists them by name.", items: unnamed });

  const client = g.enquiry.client;
  const missingClient = readinessOf(client, g.clientSettings.invoiceReadiness).missing.map((m) => m.label);
  if (!client.stateCode && !missingClient.includes("State")) missingClient.push("State");
  if (missingClient.length) blockers.push({ kind: "CLIENT", label: "Complete the client's details.", items: missingClient });

  const missingCompany = invoiceMissing(g.company, g.images);
  if (missingCompany.length) blockers.push({ kind: "COMPANY", label: "Fill in Masti's details (Settings → Company & invoice).", items: missingCompany });

  // Everything typed in that the invoice prints must be in its font (English letters): the font has no Gujarati. The
  // rest is checked by its own format (digits, PAN, GSTIN, IFSC, the website) or comes from the code.
  const bank = g.company.bank;
  const printed: [string, string | null | undefined][] = [
    ["Client's name", client.name],
    ["Client's contact person", client.contactPerson],
    ["Client's address", client.addressLine],
    ["Client's area", client.area],
    ["Client's city", client.city],
    ...g.visa.travellers.map((t): [string, string | null] => [`${label(t)}'s name`, travellerName(t)]),
    ["Masti's name", g.company.name],
    ["Masti's address", g.company.address],
    ["Masti's phone", g.company.phone],
    ["Masti's 24/7 phone", g.company.phone2],
    ["Masti's email", g.company.email],
    ["Masti's bank account name", bank?.accountName],
    ["Masti's bank name", bank?.bankName],
    ["Masti's bank branch", bank?.branch],
    ...g.terms.lines.map((term, i): [string, string] => [`Invoice terms, line ${i + 1}`, term]),
    ["The visa's description", description(g)],
    ["Your name (printed as Prepared by)", preparedBy],
  ];
  const notEnglish = printed.filter(([, text]) => text && unprintable(text).length > 0).map(([what]) => what);
  if (notEnglish.length) blockers.push({ kind: "NOT_ENGLISH", label: "Enter these in English letters: the invoice can't print them.", items: notEnglish });
  return blockers;
}

/** CGST + SGST when the client is in Masti's state, IGST otherwise; null until both states are known. */
function taxTypeOf(g: Gathered): "INTRA_STATE" | "INTER_STATE" | null {
  if (!g.enquiry.client.stateCode || !g.company.stateCode) return null;
  return g.enquiry.client.stateCode === g.company.stateCode ? "INTRA_STATE" : "INTER_STATE";
}

/** The totals the invoice will carry (0009 Decision 3): GST on the service charge only. */
function totalsOf(g: Gathered) {
  const quote = g.visa.quote!;
  const totals = quoteTotals(quote.lines, quote.serviceChargePaise, g.invoiceSetting.gstRatePercent);
  const taxType = taxTypeOf(g);
  const tax = gstPaise(quote.serviceChargePaise, g.invoiceSetting.gstRatePercent);
  const split = taxType === "INTRA_STATE" ? splitIntraState(tax) : { cgstPaise: 0, sgstPaise: 0 };
  return {
    taxType,
    grossPaise: totals.travellersPaise,
    serviceChargePaise: quote.serviceChargePaise,
    cgstPaise: split.cgstPaise,
    sgstPaise: split.sgstPaise,
    igstPaise: taxType === "INTER_STATE" ? tax : 0,
    totalPaise: totals.totalPaise,
  };
}

const formatInvoiceNo = (prefix: string, digits: number, value: number) => `${prefix}${String(value).padStart(digits, "0")}`;

/** The counter's next value, without taking it: the dialog's preview, and the number a raise makes its PDF with. */
async function nextCounterValue(g: Gathered, db: Db) {
  const counter = await db.invoiceCounter.findUnique({ where: { id: 1 } });
  return Math.max((counter?.lastValue ?? 0) + 1, g.invoiceSetting.startAt);
}

/** The number the next invoice will get (a preview: two raises at once still get consecutive numbers). */
async function nextInvoiceNo(g: Gathered, db: Db) {
  const { prefix, digits } = g.invoiceSetting;
  return formatInvoiceNo(prefix, digits, await nextCounterValue(g, db));
}

/** Another raise took the number this one's PDF was made with. */
class NumberTaken extends Error {}

/** Tries before giving up when other raises keep taking the number first. */
const RAISE_ATTEMPTS = 3;

/**
 * For the Raise invoice dialog: what blocks it, or what the invoice will say. Anyone who can open the case may look.
 */
export async function invoiceCheck(caseNo: string, user: UserWithDepartments) {
  const row = await prisma.enquiry.findUnique({
    where: { caseNo: caseNo.toUpperCase() },
    select: { id: true, ownerId: true, department: { select: { code: true } }, visa: { select: { enquiryId: true } } },
  });
  if (!row?.visa) throw notFound("Case not found.");
  assertCanSeeEnquiry(user, row);
  const g = await gather(row.id, prisma);
  const blockers = blockersOf(g, user.name);
  const ready = blockers.length === 0;
  return {
    blockers,
    alreadyRaised: g.enquiry.invoice?.invoiceNo ?? null,
    // The dialog sends back the quote, the rate, the tax type and the total it showed (raiseInvoice compares them).
    preview: ready
      ? {
          invoiceNo: await nextInvoiceNo(g, prisma),
          quoteUpdatedAt: g.visa.quote!.updatedAt,
          gstRatePercent: g.invoiceSetting.gstRatePercent,
          ...totalsOf(g),
        }
      : null,
  };
}

/** The invoice's text, from what was gathered: every word and amount the PDF prints, and the rows it stores. */
function buildView(g: Gathered, invoiceNo: string, issuedOn: string, preparedBy: string) {
  const client = g.enquiry.client;
  const state = (code: string | null) => GST_STATES.find((s) => s.code === code)?.name ?? null;
  const totals = totalsOf(g);
  const desc = description(g);
  const lines = g.visa.travellers.map((t, i) => {
    const line = g.visa.quote!.lines.find((l) => l.travellerId === t.id)!;
    return {
      position: i + 1,
      travellerId: t.id,
      name: travellerName(t)!,
      description: desc,
      form: line.form,
      lumpSumPaise: line.lumpSumPaise,
      embassyFeePaise: line.embassyFeePaise,
      vfsFeePaise: line.vfsFeePaise,
      otherFeePaise: line.otherFeePaise,
      totalPaise: lineTotalPaise(line),
    };
  });
  const view: InvoiceView = {
    invoiceNo,
    issuedOn,
    preparedBy,
    company: {
      name: g.company.name,
      address: g.company.address,
      phone: g.company.phone,
      phone2: g.company.phone2,
      email: g.company.email,
      website: g.company.website,
      pan: g.company.pan,
      gstin: g.company.gstin,
      bank: g.company.bank,
    },
    client: {
      name: client.name,
      contactPerson: client.contactPerson,
      addressLines: [client.addressLine, client.area, [client.city, client.pincode].filter(Boolean).join(" ")].filter((l): l is string => !!l),
      stateCode: client.stateCode,
      stateName: state(client.stateCode),
      mobile: client.mobile,
      pan: client.pan,
      gstin: client.gstin,
    },
    placeOfSupply: { code: client.stateCode!, name: state(client.stateCode) ?? client.stateCode! },
    taxType: totals.taxType!,
    sac: g.invoiceSetting.sac,
    gstRatePercent: g.invoiceSetting.gstRatePercent,
    lines,
    grossPaise: totals.grossPaise,
    serviceChargePaise: totals.serviceChargePaise,
    cgstPaise: totals.cgstPaise,
    sgstPaise: totals.sgstPaise,
    igstPaise: totals.igstPaise,
    totalPaise: totals.totalPaise,
    terms: g.terms.lines,
  };
  return { view, lines };
}

/**
 * Raises the case's invoice (0009 Decisions 2–9): refused while anything blocks it, or if the quote, the GST rate, the
 * tax type (the client's state) or the total changed since the dialog showed them. In one transaction under the case
 * lock: the PDF made and stored with the next number, the number taken, the file row, the invoice and its lines, and
 * the audit. The PDF is removed again if the transaction fails after storing it, and a failure uses no number.
 *
 * The counter is one row that every raise in the company takes, so it's taken last, after the PDF is made and stored:
 * a slow bucket never holds up anyone else's raise. If another raise took the number meanwhile, this one starts again
 * with the next.
 */
export async function raiseInvoice(caseNo: string, input: RaiseInvoiceInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, QUOTING);
  const pre = await gather(enquiry.id, prisma);
  const check = (g: Gathered) => {
    if (g.enquiry.invoice) throw conflict(`This case already has invoice ${g.enquiry.invoice.invoiceNo}.`);
    const blockers = blockersOf(g, actor.user.name);
    if (blockers.length) throw new HttpError(409, "The invoice can't be raised yet.", { code: "INVOICE_BLOCKED", blockers });
    assertFresh(g.visa.quote!.updatedAt, input.quoteUpdatedAt, "quote");
    const { taxType, totalPaise } = totalsOf(g);
    if (taxType !== input.taxType || g.invoiceSetting.gstRatePercent !== input.gstRatePercent || totalPaise !== input.totalPaise) {
      throw new HttpError(409, "The GST or the total changed after this opened (the GST rate or the client's state). Check the new amounts and raise again.", {
        code: "INVOICE_CHANGED",
      });
    }
  };
  check(pre);

  // The images are read before the case is locked, side by side: a slow bucket never holds the lock.
  const download = async (image: typeof pre.images.logo) => image && { bytes: await getObject(image.storageKey), contentType: image.contentType };
  const [logo, signature] = await Promise.all([download(pre.images.logo), download(pre.images.signature)]);
  const images: InvoiceImages = { logo, signature };

  for (let attempt = 1; ; attempt++) {
    let storageKey: string | null = null;
    try {
      await prisma.$transaction(
        async (tx) => {
          await lockCase(tx, enquiry.id, actor, QUOTING);
          const g = await gather(enquiry.id, tx);
          check(g);

          const { prefix, digits, startAt, gstRatePercent, sac } = g.invoiceSetting;
          const expected = await nextCounterValue(g, tx);
          const invoiceNo = formatInvoiceNo(prefix, digits, expected);
          const issuedOn = istToday();
          const { view, lines } = buildView(g, invoiceNo, issuedOn, actor.user.name);

          const pdf = await renderInvoicePdf(view, images);
          storageKey = `cases/${enquiry.id}/invoice/${randomUUID()}.pdf`;
          await putObject(storageKey, Buffer.from(pdf.bytes), "application/pdf");

          // Taken only now, and held until the commit: the inserts below are quick.
          const [counter] = await tx.$queryRaw<{ lastValue: number }[]>`
            INSERT INTO "InvoiceCounter" ("id", "lastValue") VALUES (1, ${startAt})
            ON CONFLICT ("id") DO UPDATE SET "lastValue" = GREATEST("InvoiceCounter"."lastValue" + 1, ${startAt})
            RETURNING "lastValue"`;
          if (Number(counter!.lastValue) !== expected) throw new NumberTaken();

          const family = familyName(g.enquiry.client.name).normalize("NFKD").replace(/[^A-Za-z0-9-]/g, "");
          const file = await tx.caseFile.create({
            data: {
              enquiryId: enquiry.id,
              kind: "INVOICE",
              storageKey,
              fileName: family ? `${invoiceNo}_${family}.pdf` : `${invoiceNo}.pdf`,
              sizeBytes: pdf.bytes.length,
              pageCount: pdf.pageCount,
              uploadedById: actor.user.id,
            },
          });
          const invoice = await tx.invoice.create({
            data: {
              invoiceNo,
              enquiryId: enquiry.id,
              issuedOn: toDbDate(issuedOn),
              issuedById: actor.user.id,
              client: view.client as unknown as Prisma.InputJsonValue,
              company: view.company as unknown as Prisma.InputJsonValue,
              terms: view.terms,
              placeOfSupply: view.placeOfSupply.code,
              taxType: view.taxType,
              sac,
              gstRateBp: rateBasisPoints(gstRatePercent),
              processingSpeed: g.visa.quote!.processingSpeed.name,
              grossPaise: view.grossPaise,
              serviceChargePaise: view.serviceChargePaise,
              cgstPaise: view.cgstPaise,
              sgstPaise: view.sgstPaise,
              igstPaise: view.igstPaise,
              totalPaise: view.totalPaise,
              fileId: file.id,
              lines: { create: lines },
            },
          });
          await audit(
            {
              actorId: actor.user.id,
              action: "visa.invoice.raise",
              entityType: "Enquiry",
              entityId: enquiry.id,
              clientId: g.enquiry.clientId,
              after: { invoiceId: invoice.id, invoiceNo, totalPaise: view.totalPaise, taxType: view.taxType, fileId: file.id },
              ip: actor.ip,
            },
            tx,
          );
        },
        // Making the PDF and storing it takes a moment; the case lock is held for it so no one changes the quote meanwhile.
        { timeout: 30_000 },
      );
      break;
    } catch (err) {
      if (storageKey) {
        const key = storageKey;
        await deleteObject(key).catch((cleanupErr) => console.error(`Couldn't remove unsaved invoice ${key}:`, cleanupErr));
      }
      if (!(err instanceof NumberTaken)) throw err;
      if (attempt === RAISE_ATTEMPTS) throw conflict("Other invoices were being raised at the same moment. Please try again.");
    }
  }
  return getVisaCaseById(enquiry.id);
}

/** Saving a quote (visaQuote.service.ts) calls this under the case lock: a raised invoice freezes the quote. */
export async function assertNotInvoiced(tx: Db, enquiryId: string) {
  const invoice = await tx.invoice.findUnique({ where: { enquiryId }, select: { invoiceNo: true } });
  if (invoice) throw conflict(`Invoice ${invoice.invoiceNo} is raised, so the quote can't change.`);
}
