import { randomUUID } from "node:crypto";
import type { Prisma } from "../../../generated/prisma/client";
import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { fromDbDate, istToday, toDbDate } from "../../lib/dates";
import { conflict, fieldError, HttpError } from "../../lib/httpError";
import { logger } from "../../lib/logger";
import { GST_STATES } from "../../lib/shared.schemas";
import { deleteObject, getObject, putObject } from "../../lib/storage";
import { currentCompanyImages } from "../company/company.service";
import { getCompanyDetails, invoiceMissing } from "../company/company.settings";
import type { Actor, UserWithDepartments } from "../users/user";
import { findVisibleCase, INVOICED, loadCase, lockCase } from "./caseLock";
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

// Correcting a wrong invoice (docs/decisions/0011-visa-at-vendor.md Decision 5). An invoice is never changed (golden
// rule 3, M36): a WHOLE credit note cancels it, giving back exactly what it charged, its GST included, so the tax
// reports net to zero. Issued by the case's owner, the Visa HOD or the Head, at any step, with a reason from the list;
// numbered in its own series (MCN ⚠️) and stored as a PDF in the invoice's layout. Never edited (triggers).
//
// Like raising the invoice, the PDF is made and stored before the one-row counter is taken, so a slow bucket never holds
// up anyone else; if another credit note took the number meanwhile, this one starts again with the next.

/**
 * The case's latest invoice and what its credit note prints, read together (inside the transaction when issuing). A
 * case has one chain of invoices, so only the latest can still stand: earlier ones were cancelled and replaced.
 */
async function gather(enquiryId: string, db: Db) {
  const enquiry = await db.enquiry.findUniqueOrThrow({
    where: { id: enquiryId },
    select: {
      clientId: true,
      invoices: {
        orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
        take: 1,
        include: {
          lines: { orderBy: { position: "asc" } },
          creditNotes: { where: { kind: "WHOLE" }, select: { creditNoteNo: true } },
        },
      },
    },
  });
  const [company, settings, images] = await Promise.all([getCompanyDetails(db), getVisaSettings(db), currentCompanyImages()]);
  return { clientId: enquiry.clientId, invoice: enquiry.invoices[0] ?? null, company, series: settings.creditNote, images };
}

type Gathered = Awaited<ReturnType<typeof gather>>;

/** What stands in the way of printing it: Masti's details, as for the invoice. Empty means it can be issued. */
function blockersOf(g: Gathered, preparedBy: string): InvoiceBlocker[] {
  const blockers: InvoiceBlocker[] = [];
  const missing = invoiceMissing(g.company, g.images);
  if (missing.length) blockers.push({ kind: "COMPANY", label: "Fill in Masti's details (Settings → Company & invoice).", items: missing });
  const notEnglish = notInEnglish([...companyPrinted(g.company), preparedByPrinted(preparedBy)]);
  if (notEnglish.length) blockers.push({ kind: "NOT_ENGLISH", label: "Enter these in English letters: the credit note can't print them.", items: notEnglish });
  return blockers;
}

/** The counter's next value, without taking it. */
async function nextCounterValue(g: Gathered, db: Db) {
  const counter = await db.creditNoteCounter.findUnique({ where: { id: 1 } });
  return Math.max((counter?.lastValue ?? 0) + 1, g.series.startAt);
}

/** The credit note's text: the invoice's own amounts and lines, all of them given back, with Masti's details now. */
function viewOf(g: Gathered, creditNoteNo: string, issuedOn: string, preparedBy: string): InvoiceView {
  const inv = g.invoice!;
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
    lines: inv.lines.map((l) => ({
      position: l.position,
      name: l.name,
      description: l.description,
      form: l.form,
      lumpSumPaise: l.lumpSumPaise,
      embassyFeePaise: l.embassyFeePaise,
      vfsFeePaise: l.vfsFeePaise,
      otherFeePaise: l.otherFeePaise,
      totalPaise: l.totalPaise,
    })),
    grossPaise: inv.grossPaise,
    serviceChargePaise: inv.serviceChargePaise,
    cgstPaise: inv.cgstPaise,
    sgstPaise: inv.sgstPaise,
    igstPaise: inv.igstPaise,
    totalPaise: inv.totalPaise,
    terms: [],
  };
}

/**
 * For the Cancel dialog: the invoice, everything its credit note will give back (GST included), the number it will get,
 * and what blocks it. Anyone who can open the case may look.
 */
export async function cancelInvoiceCheck(caseNo: string, user: UserWithDepartments) {
  const { id } = await findVisibleCase(caseNo, user);
  const g = await gather(id, prisma);
  const inv = g.invoice;
  if (!inv) throw conflict("This case has no invoice yet.");
  return {
    invoiceNo: inv.invoiceNo,
    alreadyCancelled: inv.creditNotes[0]?.creditNoteNo ?? null,
    blockers: blockersOf(g, user.name),
    preview: {
      creditNoteNo: formatSeriesNo(g.series.prefix, g.series.digits, await nextCounterValue(g, prisma)),
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
 * it's already cancelled, or while Masti's details can't be printed. In one transaction under the case lock: the PDF
 * made and stored with the next number, the number taken, the file, the credit note and its lines, and the audit. The
 * invoice itself is untouched; from now on it counts as cancelled.
 */
export async function cancelInvoice(caseNo: string, input: CancelInvoiceInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, INVOICED);
  const check = async (g: Gathered, db: Db) => {
    const inv = g.invoice;
    if (!inv || inv.invoiceNo !== input.invoiceNo || inv.totalPaise !== input.totalPaise) {
      throw new HttpError(409, "This case's invoice changed after this opened. Look at it again.", { code: "CREDIT_NOTE_CHANGED" });
    }
    if (inv.creditNotes.length) throw conflict(`Invoice ${inv.invoiceNo} is already cancelled by ${inv.creditNotes[0]!.creditNoteNo}.`);
    const reason = await db.creditNoteReason.findUnique({ where: { id: input.reasonId } });
    if (!reason?.isActive) throw fieldError("reasonId", "Pick an active reason.");
    const blockers = blockersOf(g, actor.user.name);
    if (blockers.length) throw new HttpError(409, "The credit note can't be issued yet.", { code: "CREDIT_NOTE_BLOCKED", blockers });
    return { inv, reason };
  };
  const pre = await gather(enquiry.id, prisma);
  await check(pre, prisma);

  // The images are read before the case is locked, side by side: a slow bucket never holds the lock.
  const download = async (image: typeof pre.images.logo) => image && { bytes: await getObject(image.storageKey), contentType: image.contentType };
  const [logo, signature] = await Promise.all([download(pre.images.logo), download(pre.images.signature)]);
  const images: InvoiceImages = { logo, signature };

  for (let attempt = 1; ; attempt++) {
    let storageKey: string | null = null;
    try {
      await prisma.$transaction(
        async (tx) => {
          await lockCase(tx, enquiry.id, actor, INVOICED);
          const g = await gather(enquiry.id, tx);
          const { inv, reason } = await check(g, tx);

          const { prefix, digits, startAt } = g.series;
          const expected = await nextCounterValue(g, tx);
          const creditNoteNo = formatSeriesNo(prefix, digits, expected);
          const issuedOn = istToday();
          const view = viewOf(g, creditNoteNo, issuedOn, actor.user.name);

          const pdf = await renderInvoicePdf(view, images, {
            kind: "CREDIT_NOTE",
            againstInvoiceNo: inv.invoiceNo,
            againstIssuedOn: fromDbDate(inv.issuedOn),
            reason: reason.name,
          });
          storageKey = `cases/${enquiry.id}/credit-note/${randomUUID()}.pdf`;
          await putObject(storageKey, Buffer.from(pdf.bytes), "application/pdf");

          // Taken only now, and held until the commit: the inserts below are quick.
          const [counter] = await tx.$queryRaw<{ lastValue: number }[]>`
            INSERT INTO "CreditNoteCounter" ("id", "lastValue") VALUES (1, ${startAt})
            ON CONFLICT ("id") DO UPDATE SET "lastValue" = GREATEST("CreditNoteCounter"."lastValue" + 1, ${startAt})
            RETURNING "lastValue"`;
          if (Number(counter!.lastValue) !== expected) throw new NumberTaken();

          const family = fileSafeFamilyName(view.client.name);
          const file = await tx.caseFile.create({
            data: {
              enquiryId: enquiry.id,
              kind: "CREDIT_NOTE",
              storageKey,
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
              enquiryId: enquiry.id,
              kind: "WHOLE",
              reasonId: reason.id,
              issuedOn: toDbDate(issuedOn),
              issuedById: actor.user.id,
              client: inv.client as Prisma.InputJsonValue,
              company: view.company as unknown as Prisma.InputJsonValue,
              grossPaise: inv.grossPaise,
              serviceChargePaise: inv.serviceChargePaise,
              cgstPaise: inv.cgstPaise,
              sgstPaise: inv.sgstPaise,
              igstPaise: inv.igstPaise,
              totalPaise: inv.totalPaise,
              fileId: file.id,
              lines: {
                create: inv.lines.map((l) => ({
                  position: l.position,
                  invoicePosition: l.position,
                  name: l.name,
                  description: l.description,
                  form: l.form,
                  lumpSumPaise: l.lumpSumPaise,
                  embassyFeePaise: l.embassyFeePaise,
                  vfsFeePaise: l.vfsFeePaise,
                  otherFeePaise: l.otherFeePaise,
                  totalPaise: l.totalPaise,
                })),
              },
            },
          });
          await audit(
            {
              actorId: actor.user.id,
              action: "visa.creditNote.issue",
              entityType: "Enquiry",
              entityId: enquiry.id,
              clientId: g.clientId,
              after: { creditNoteId: note.id, creditNoteNo, kind: "WHOLE", invoiceNo: inv.invoiceNo, reason: reason.code, totalPaise: inv.totalPaise, fileId: file.id },
              ip: actor.ip,
            },
            tx,
          );
        },
        // Making the PDF and storing it takes a moment; the case lock is held for it.
        { timeout: 30_000 },
      );
      break;
    } catch (err) {
      if (storageKey) {
        const key = storageKey;
        await deleteObject(key).catch((cleanupErr) => logger.error({ err: cleanupErr, storageKey: key }, "Couldn't remove an unsaved credit note."));
      }
      if (!(err instanceof NumberTaken)) throw err;
      if (attempt === RAISE_ATTEMPTS) throw conflict("Other credit notes were being issued at the same moment. Please try again.");
    }
  }
  return getVisaCaseById(enquiry.id);
}
