import { randomUUID } from "node:crypto";
import type { Prisma } from "../../../generated/prisma/client";
import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { fromDbDate, istToday, toDbDate } from "../../lib/dates";
import { conflict, fieldError, forbidden, HttpError } from "../../lib/httpError";
import { logger } from "../../lib/logger";
import { GST_STATES } from "../../lib/shared.schemas";
import { deleteObject, getObject, putObject } from "../../lib/storage";
import { currentCompanyImages } from "../company/company.service";
import { getCompanyDetails, invoiceMissing } from "../company/company.settings";
import { isHodOf } from "../auth/permissions";
import type { Actor, UserWithDepartments } from "../users/user";
import { CREDITING, findVisibleCase, loadCase, lockCase } from "./caseLock";
import { renderInvoicePdf, type InvoiceImages, type InvoiceParty, type InvoiceView } from "./invoicePdf";
import type { CancelInvoiceInput } from "./visa.schemas";
import { getVisaCaseById } from "./visa.service";
import { getVisaSettings } from "./visa.settings";
import { fileSafeFamilyName } from "./visaCase";
import {
  companyPrinted,
  companyView,
  formatSeriesNo,
  notInEnglish,
  NumberTaken,
  preparedByPrinted,
  RAISE_ATTEMPTS,
  type InvoiceBlocker,
} from "./visaInvoice.service";
import { queueCreditNoteMessage } from "./visaMessages";

// Credit notes (docs/decisions/0011-visa-at-vendor.md Decisions 5 and 6). An invoice is never changed (golden rule 3,
// M36). A WHOLE credit note cancels a wrong one, giving back exactly what it charged, its GST included, so the tax
// reports net to zero; a PART one gives back some travellers' amounts on a recall (visaRecall.service.ts), with no GST.
// Both are numbered in their own series (MCN ⚠️), stored as a PDF in the invoice's layout, never edited (triggers), and
// never give back more than the invoice charged (a trigger).
//
// Like raising the invoice, the PDF is made and stored before the one-row counter is taken, so a slow bucket never holds
// up anyone else; if another credit note took the number meanwhile, the caller's transaction starts again with the next.

/**
 * An invoice of the case and what a credit note against it prints, read together (inside the transaction when
 * issuing): the one numbered `invoiceNo` (the main invoice or the additional one, 0011 Decision 7), or else the main
 * invoice's chain's latest. A chain has one standing invoice at most, so earlier ones were cancelled.
 */
export async function gatherForCredit(enquiryId: string, db: Db, invoiceNo?: string) {
  const enquiry = await db.enquiry.findUniqueOrThrow({
    where: { id: enquiryId },
    select: {
      clientId: true,
      invoices: {
        where: invoiceNo ? { invoiceNo } : { kind: "MAIN" },
        orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
        take: 1,
        include: {
          lines: { orderBy: { position: "asc" } },
          charges: { orderBy: { position: "asc" } },
          creditNotes: { orderBy: { issuedAt: "asc" }, select: { creditNoteNo: true, kind: true, totalPaise: true } },
        },
      },
    },
  });
  const [company, settings, images] = await Promise.all([getCompanyDetails(db), getVisaSettings(db), currentCompanyImages()]);
  return { clientId: enquiry.clientId, invoice: enquiry.invoices[0] ?? null, company, series: settings.creditNote, images };
}

export type CreditGathered = Awaited<ReturnType<typeof gatherForCredit>>;
export type CreditInvoice = NonNullable<CreditGathered["invoice"]>;

/** The WHOLE credit note that cancelled this invoice, if one did. */
export const cancellationOf = (inv: CreditInvoice) => inv.creditNotes.find((n) => n.kind === "WHOLE") ?? null;

/** What stands in the way of printing one: Masti's details, as for the invoice. Empty means it can be issued. */
export function creditBlockers(g: CreditGathered, preparedBy: string): InvoiceBlocker[] {
  const blockers: InvoiceBlocker[] = [];
  const missing = invoiceMissing(g.company, g.images);
  if (missing.length) blockers.push({ kind: "COMPANY", label: "Fill in Masti's details (Settings → Company & invoice).", items: missing });
  const notEnglish = notInEnglish([...companyPrinted(g.company), preparedByPrinted(preparedBy)]);
  if (notEnglish.length) blockers.push({ kind: "NOT_ENGLISH", label: "Enter these in English letters: the credit note can't print them.", items: notEnglish });
  return blockers;
}

/** The counter's next value, without taking it. */
async function nextCounterValue(g: CreditGathered, db: Db) {
  const counter = await db.creditNoteCounter.findUnique({ where: { id: 1 } });
  return Math.max((counter?.lastValue ?? 0) + 1, g.series.startAt);
}

/** The number the next credit note will get (a preview). */
export async function nextCreditNoteNo(g: CreditGathered, db: Db) {
  return formatSeriesNo(g.series.prefix, g.series.digits, await nextCounterValue(g, db));
}

/** The logo and signature, read before the case is locked and side by side: a slow bucket never holds the lock. */
export async function creditImages(g: CreditGathered): Promise<InvoiceImages> {
  const download = async (image: typeof g.images.logo) => image && { bytes: await getObject(image.storageKey), contentType: image.contentType };
  const [logo, signature] = await Promise.all([download(g.images.logo), download(g.images.signature)]);
  return { logo, signature };
}

/** One traveller's amounts a credit note gives back, from the invoice's line `invoicePosition`. */
export interface CreditLine {
  invoicePosition: number;
  name: string;
  description: string;
  form: "LUMP_SUM" | "ITEMISED";
  lumpSumPaise: number | null;
  embassyFeePaise: number | null;
  vfsFeePaise: number | null;
  otherFeePaise: number | null;
  totalPaise: number;
}

/** What a credit note gives back, and why: built by the caller from the invoice. */
export interface CreditDraft {
  kind: "WHOLE" | "PART";
  reason: { id: number; code: string };
  /** What the PDF prints as the reason: "Wrong amount", "Recall · Embassy taking too long". */
  printedReason: string;
  lines: CreditLine[];
  grossPaise: number;
  serviceChargePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
}

/** A WHOLE credit note's draft: every amount and line of the invoice given back. */
export function wholeDraft(inv: CreditInvoice, reason: { id: number; code: string; name: string }): CreditDraft {
  // An additional invoice's extra charges come back as one line each (0011 Decision 7).
  const lines: CreditLine[] =
    inv.kind === "ADDITIONAL"
      ? inv.charges.map((c) => ({
          invoicePosition: c.position,
          name: c.name,
          description: "Additional charge",
          form: "LUMP_SUM",
          lumpSumPaise: c.amountPaise,
          embassyFeePaise: null,
          vfsFeePaise: null,
          otherFeePaise: null,
          totalPaise: c.amountPaise,
        }))
      : inv.lines.map((l) => ({
          invoicePosition: l.position,
          name: l.name,
          description: l.description,
          form: l.form,
          lumpSumPaise: l.lumpSumPaise,
          embassyFeePaise: l.embassyFeePaise,
          vfsFeePaise: l.vfsFeePaise,
          otherFeePaise: l.otherFeePaise,
          totalPaise: l.totalPaise,
        }));
  return {
    kind: "WHOLE",
    reason,
    printedReason: reason.name,
    lines,
    grossPaise: inv.grossPaise,
    serviceChargePaise: inv.serviceChargePaise,
    cgstPaise: inv.cgstPaise,
    sgstPaise: inv.sgstPaise,
    igstPaise: inv.igstPaise,
    totalPaise: inv.totalPaise,
  };
}

/** The credit note's text: the draft's amounts and lines, against the invoice's client, with Masti's details now. */
function viewOf(g: CreditGathered, inv: CreditInvoice, draft: CreditDraft, creditNoteNo: string, issuedOn: string, preparedBy: string): InvoiceView {
  return {
    invoiceNo: creditNoteNo,
    issuedOn,
    preparedBy,
    company: companyView(g.company),
    client: inv.client as unknown as InvoiceParty,
    placeOfSupply: { code: inv.placeOfSupply, name: GST_STATES.find((s) => s.code === inv.placeOfSupply)?.name ?? inv.placeOfSupply },
    taxType: inv.taxType,
    sac: inv.sac,
    gstRatePercent: inv.gstRateBp / 100,
    lines: draft.lines.map((l, i) => ({ ...l, position: i + 1 })),
    grossPaise: draft.grossPaise,
    serviceChargePaise: draft.serviceChargePaise,
    cgstPaise: draft.cgstPaise,
    sgstPaise: draft.sgstPaise,
    igstPaise: draft.igstPaise,
    totalPaise: draft.totalPaise,
    terms: [],
  };
}

/** Where a transaction attempt stored its PDF, so the retry loop can remove it if the attempt fails. */
export interface Upload {
  storageKey: string | null;
}

/**
 * In the caller's transaction, under the case lock: makes and stores the PDF with the next number, takes the number
 * (throwing NumberTaken if another credit note took it meanwhile), and inserts the file, the credit note and its lines,
 * with its audit row. Run it inside withCreditNoteNumber.
 */
export async function issueCreditNote(
  tx: Db,
  args: { enquiryId: string; g: CreditGathered; inv: CreditInvoice; draft: CreditDraft; images: InvoiceImages; actor: Actor; upload: Upload },
) {
  const { enquiryId, g, inv, draft, images, actor, upload } = args;
  const { startAt } = g.series;
  const expected = await nextCounterValue(g, tx);
  const creditNoteNo = formatSeriesNo(g.series.prefix, g.series.digits, expected);
  const issuedOn = istToday();
  const view = viewOf(g, inv, draft, creditNoteNo, issuedOn, actor.user.name);

  const pdf = await renderInvoicePdf(view, images, {
    kind: "CREDIT_NOTE",
    againstInvoiceNo: inv.invoiceNo,
    againstIssuedOn: fromDbDate(inv.issuedOn),
    reason: draft.printedReason,
  });
  upload.storageKey = `cases/${enquiryId}/credit-note/${randomUUID()}.pdf`;
  await putObject(upload.storageKey, Buffer.from(pdf.bytes), "application/pdf");

  // Taken only now, and held until the commit: the inserts below are quick.
  const [counter] = await tx.$queryRaw<{ lastValue: number }[]>`
    INSERT INTO "CreditNoteCounter" ("id", "lastValue") VALUES (1, ${startAt})
    ON CONFLICT ("id") DO UPDATE SET "lastValue" = GREATEST("CreditNoteCounter"."lastValue" + 1, ${startAt})
    RETURNING "lastValue"`;
  if (Number(counter!.lastValue) !== expected) throw new NumberTaken();

  const family = fileSafeFamilyName(view.client.name);
  const file = await tx.caseFile.create({
    data: {
      enquiryId,
      kind: "CREDIT_NOTE",
      storageKey: upload.storageKey,
      fileName: family ? `${creditNoteNo}_${family}.pdf` : `${creditNoteNo}.pdf`,
      sizeBytes: pdf.bytes.length,
      pageCount: pdf.pageCount,
      uploadedById: actor.user.id,
    },
  });
  const note = await tx.creditNote.create({
    data: {
      creditNoteNo,
      invoiceId: inv.id,
      enquiryId,
      kind: draft.kind,
      reasonId: draft.reason.id,
      issuedOn: toDbDate(issuedOn),
      issuedById: actor.user.id,
      client: inv.client as Prisma.InputJsonValue,
      company: view.company as unknown as Prisma.InputJsonValue,
      grossPaise: draft.grossPaise,
      serviceChargePaise: draft.serviceChargePaise,
      cgstPaise: draft.cgstPaise,
      sgstPaise: draft.sgstPaise,
      igstPaise: draft.igstPaise,
      totalPaise: draft.totalPaise,
      fileId: file.id,
      lines: { create: draft.lines.map((l, i) => ({ ...l, position: i + 1 })) },
    },
  });
  await audit(
    {
      actorId: actor.user.id,
      action: "visa.creditNote.issue",
      entityType: "Enquiry",
      entityId: enquiryId,
      clientId: g.clientId,
      after: { creditNoteId: note.id, creditNoteNo, kind: draft.kind, invoiceNo: inv.invoiceNo, reason: draft.reason.code, totalPaise: draft.totalPaise, fileId: file.id },
      ip: actor.ip,
    },
    tx,
  );
  // Message 18 (docs/whatsapp-visa-messages.md); a retried number rolls it back with the rest.
  await queueCreditNoteMessage(tx, enquiryId, { id: note.id, creditNoteNo, totalPaise: draft.totalPaise, invoiceNo: inv.invoiceNo });
  return { creditNoteNo, fileId: file.id };
}

/**
 * Runs `attempt` (a whole transaction that issues a credit note) until it gets a number: another credit note taking the
 * number first starts it again, up to RAISE_ATTEMPTS times. A stored PDF of a failed attempt is removed.
 */
export async function withCreditNoteNumber(attempt: (upload: Upload) => Promise<void>) {
  for (let tries = 1; ; tries++) {
    const upload: Upload = { storageKey: null };
    try {
      await attempt(upload);
      return;
    } catch (err) {
      if (upload.storageKey) {
        const key = upload.storageKey;
        await deleteObject(key).catch((cleanupErr) => logger.error({ err: cleanupErr, storageKey: key }, "Couldn't remove an unsaved credit note."));
      }
      if (!(err instanceof NumberTaken)) throw err;
      if (tries === RAISE_ATTEMPTS) throw conflict("Other credit notes were being issued at the same moment. Please try again.");
    }
  }
}

/**
 * On a cancelled case no corrected invoice follows, so a credit note gives the client's money back: only the Visa HOD
 * or the Head may issue it, as only they can give back more on a recall (0006 amendment 15, decided 17 Oct 2026).
 */
function assertMayCredit(status: string, actor: Actor) {
  if (status === "CANCELLED" && !isHodOf(actor.user, "VISA")) {
    throw forbidden("On a cancelled case only the Visa HOD or the Head can cancel its invoice: it gives the client's money back.");
  }
}

/**
 * For the Cancel dialog: the invoice, everything its credit note will give back (GST included), the number it will get,
 * what blocks it, and whether only the Visa HOD or the Head may issue it (a cancelled case). Anyone who can open the case
 * may look.
 */
export async function cancelInvoiceCheck(caseNo: string, user: UserWithDepartments, invoiceNo?: string) {
  const { id } = await findVisibleCase(caseNo, user);
  const [g, { status }] = await Promise.all([
    gatherForCredit(id, prisma, invoiceNo),
    prisma.enquiry.findUniqueOrThrow({ where: { id }, select: { status: true } }),
  ]);
  const inv = g.invoice;
  if (!inv) throw conflict("This case has no invoice yet.");
  return {
    invoiceNo: inv.invoiceNo,
    alreadyCancelled: cancellationOf(inv)?.creditNoteNo ?? null,
    hodOnly: status === "CANCELLED",
    blockers: creditBlockers(g, user.name),
    preview: {
      creditNoteNo: await nextCreditNoteNo(g, prisma),
      taxType: inv.taxType,
      grossPaise: inv.grossPaise,
      serviceChargePaise: inv.serviceChargePaise,
      cgstPaise: inv.cgstPaise,
      sgstPaise: inv.sgstPaise,
      igstPaise: inv.igstPaise,
      totalPaise: inv.totalPaise,
    },
  };
}

/**
 * "Cancel with a credit note" (Decision 5). Refused if the invoice or its total isn't the one the dialog showed, if
 * it's already cancelled or partly given back (a recall), or while Masti's details can't be printed. In one transaction
 * under the case lock: the WHOLE credit note issued (PDF, number, file, rows, audit). The invoice itself is untouched;
 * from now on it counts as cancelled. On an open case, a delivered (closed) one or a cancelled one (CREDITING); on a
 * cancelled one, by the Visa HOD or the Head only, as no corrected invoice follows (0006 amendment 15).
 */
export async function cancelInvoice(caseNo: string, input: CancelInvoiceInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, CREDITING);
  assertMayCredit(enquiry.status, actor);
  const check = async (g: CreditGathered, db: Db) => {
    const inv = g.invoice;
    if (!inv || inv.invoiceNo !== input.invoiceNo || inv.totalPaise !== input.totalPaise) {
      throw new HttpError(409, "This case's invoice changed after this opened. Look at it again.", { code: "CREDIT_NOTE_CHANGED" });
    }
    const cancelled = cancellationOf(inv);
    if (cancelled) throw conflict(`Invoice ${inv.invoiceNo} is already cancelled by ${cancelled.creditNoteNo}.`);
    const part = inv.creditNotes.find((n) => n.kind === "PART");
    if (part) throw conflict(`Credit note ${part.creditNoteNo} already gave part of invoice ${inv.invoiceNo} back, so it can't be cancelled whole.`);
    const reason = await db.creditNoteReason.findUnique({ where: { id: input.reasonId } });
    if (!reason?.isActive) throw fieldError("reasonId", "Pick an active reason.");
    const blockers = creditBlockers(g, actor.user.name);
    if (blockers.length) throw new HttpError(409, "The credit note can't be issued yet.", { code: "CREDIT_NOTE_BLOCKED", blockers });
    return { inv, reason };
  };
  const pre = await gatherForCredit(enquiry.id, prisma, input.invoiceNo);
  await check(pre, prisma);
  const images = await creditImages(pre);

  await withCreditNoteNumber((upload) =>
    prisma.$transaction(
      async (tx) => {
        const locked = await lockCase(tx, enquiry.id, actor, CREDITING);
        assertMayCredit(locked.status, actor);
        const g = await gatherForCredit(enquiry.id, tx, input.invoiceNo);
        const { inv, reason } = await check(g, tx);
        await issueCreditNote(tx, { enquiryId: enquiry.id, g, inv, draft: wholeDraft(inv, reason), images, actor, upload });
      },
      // Making the PDF and storing it takes a moment; the case lock is held for it.
      { timeout: 30_000 },
    ),
  );
  return getVisaCaseById(enquiry.id);
}
