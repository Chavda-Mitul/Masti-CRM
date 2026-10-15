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
import { getCompanyDetails, getInvoiceTerms, invoiceMissing } from "../company/company.settings";
import type { Actor, UserWithDepartments } from "../users/user";
import { findVisibleCase, INVOICED, loadCase, lockCase } from "./caseLock";
import { renderInvoicePdf, type InvoiceImages, type InvoiceParty, type InvoiceView } from "./invoicePdf";
import type { RaiseAdditionalInvoiceInput } from "./visa.schemas";
import { getVisaCaseById } from "./visa.service";
import { fileSafeFamilyName } from "./visaCase";
import { companyPrinted, companyView, notInEnglish, preparedByPrinted, type InvoiceBlocker } from "./visaInvoice.service";

// The one additional invoice per file (docs/decisions/0011-visa-at-vendor.md Decision 7, golden rule 3): extra costs
// after the main invoice, such as an urgent submission charge or photos, picked from the extra-charges list with the
// amount typed. Numbered after its main invoice ("MVI00000001-A"), with no GST (decided 15 Oct 2026; M38(a) to
// confirm). Raised by the case's owner, the Visa HOD or the Head, at any step once the main invoice stands. Locked like
// the main invoice (the triggers), with its own PDF in the same layout. It goes to the client the main invoice went to.

/** The case's invoices, newest first, each with the WHOLE credit note that cancelled it; and what the PDF prints. */
async function gather(enquiryId: string, db: Db) {
  const enquiry = await db.enquiry.findUniqueOrThrow({
    where: { id: enquiryId },
    select: {
      clientId: true,
      invoices: {
        orderBy: [{ issuedAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          kind: true,
          invoiceNo: true,
          issuedOn: true,
          client: true,
          placeOfSupply: true,
          taxType: true,
          sac: true,
          processingSpeed: true,
          creditNotes: { where: { kind: "WHOLE" }, select: { creditNoteNo: true } },
        },
      },
    },
  });
  const [company, terms, images] = await Promise.all([getCompanyDetails(db), getInvoiceTerms(db), currentCompanyImages()]);
  const standing = (kind: "MAIN" | "ADDITIONAL") => enquiry.invoices.find((i) => i.kind === kind && i.creditNotes.length === 0) ?? null;
  return { clientId: enquiry.clientId, main: standing("MAIN"), additional: standing("ADDITIONAL"), company, terms, images };
}

type Gathered = Awaited<ReturnType<typeof gather>>;

/** Its number: the main invoice's with "-A" (the demo's INV-0412-A). */
const numberFor = (mainInvoiceNo: string) => `${mainInvoiceNo}-A`;

/** What stands in the way of printing it: Masti's details, as for the main invoice. Empty means it can be raised. */
function blockersOf(g: Gathered, preparedBy: string): InvoiceBlocker[] {
  const blockers: InvoiceBlocker[] = [];
  const missing = invoiceMissing(g.company, g.images);
  if (missing.length) blockers.push({ kind: "COMPANY", label: "Fill in Masti's details (Settings → Company & invoice).", items: missing });
  const notEnglish = notInEnglish([
    ...companyPrinted(g.company),
    ...g.terms.lines.map((term, i): [string, string] => [`Invoice terms, line ${i + 1}`, term]),
    preparedByPrinted(preparedBy),
  ]);
  if (notEnglish.length) blockers.push({ kind: "NOT_ENGLISH", label: "Enter these in English letters: the invoice can't print them.", items: notEnglish });
  return blockers;
}

/** For the dialog: the main invoice it adds to, the number it will get, whether it's already raised, and what blocks it. */
export async function additionalInvoiceCheck(caseNo: string, user: UserWithDepartments) {
  const { id } = await findVisibleCase(caseNo, user);
  const g = await gather(id, prisma);
  if (!g.main) throw conflict("Raise the invoice first: an additional invoice follows it.");
  return {
    mainInvoiceNo: g.main.invoiceNo,
    alreadyRaised: g.additional?.invoiceNo ?? null,
    invoiceNo: numberFor(g.main.invoiceNo),
    blockers: blockersOf(g, user.name),
  };
}

/**
 * Raises the file's additional invoice (Decision 7). Refused without a standing main invoice, when one is already
 * raised ("1 of 1"), for a switched-off charge, when the main invoice or the total isn't the one the dialog showed, or
 * while Masti's details can't be printed. In one transaction under the case lock: the PDF made and stored, the file, the
 * invoice and its charges, and the audit. No counter: its number comes from the main invoice.
 */
export async function raiseAdditionalInvoice(caseNo: string, input: RaiseAdditionalInvoiceInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, INVOICED);
  const check = async (g: Gathered, db: Db) => {
    const main = g.main;
    if (!main) throw conflict("Raise the invoice first: an additional invoice follows it.");
    if (g.additional) throw conflict(`This file's one additional invoice is ${g.additional.invoiceNo}: 1 of 1 used.`);
    const ids = [...new Set(input.charges.map((c) => c.chargeId))];
    const found = await db.extraCharge.findMany({ where: { id: { in: ids } } });
    if (found.length !== ids.length || found.some((c) => !c.isActive)) throw fieldError("charges", "Pick charges from the list.");
    const totalPaise = input.charges.reduce((n, c) => n + c.amountPaise, 0);
    if (main.invoiceNo !== input.mainInvoiceNo || totalPaise !== input.totalPaise) {
      throw new HttpError(409, "The invoice or the total changed after this opened. Check them and raise again.", { code: "ADDITIONAL_CHANGED" });
    }
    const blockers = blockersOf(g, actor.user.name);
    if (blockers.length) throw new HttpError(409, "The additional invoice can't be raised yet.", { code: "ADDITIONAL_BLOCKED", blockers });
    const names = new Map(found.map((c) => [c.id, c.name]));
    const charges = input.charges.map((c, i) => ({ position: i + 1, chargeId: c.chargeId, name: names.get(c.chargeId)!, amountPaise: c.amountPaise }));
    return { main, charges, totalPaise };
  };
  const pre = await gather(enquiry.id, prisma);
  await check(pre, prisma);

  // The images are read before the case is locked, side by side: a slow bucket never holds the lock.
  const download = async (image: typeof pre.images.logo) => image && { bytes: await getObject(image.storageKey), contentType: image.contentType };
  const [logo, signature] = await Promise.all([download(pre.images.logo), download(pre.images.signature)]);
  const images: InvoiceImages = { logo, signature };

  let storageKey: string | null = null;
  try {
    await prisma.$transaction(
      async (tx) => {
        await lockCase(tx, enquiry.id, actor, INVOICED);
        const g = await gather(enquiry.id, tx);
        const { main, charges, totalPaise } = await check(g, tx);

        const invoiceNo = numberFor(main.invoiceNo);
        const issuedOn = istToday();
        const client = main.client as unknown as InvoiceParty;
        const view: InvoiceView = {
          invoiceNo,
          issuedOn,
          preparedBy: actor.user.name,
          company: companyView(g.company),
          client,
          placeOfSupply: { code: main.placeOfSupply, name: GST_STATES.find((s) => s.code === main.placeOfSupply)?.name ?? main.placeOfSupply },
          taxType: main.taxType,
          sac: main.sac,
          gstRatePercent: 0,
          lines: charges.map((c) => ({
            position: c.position,
            name: c.name,
            description: "Additional charge",
            form: "LUMP_SUM",
            lumpSumPaise: c.amountPaise,
            embassyFeePaise: null,
            vfsFeePaise: null,
            otherFeePaise: null,
            totalPaise: c.amountPaise,
          })),
          grossPaise: totalPaise,
          serviceChargePaise: 0,
          cgstPaise: 0,
          sgstPaise: 0,
          igstPaise: 0,
          totalPaise,
          terms: g.terms.lines,
        };
        const pdf = await renderInvoicePdf(view, images, {
          kind: "INVOICE",
          additionalTo: { invoiceNo: main.invoiceNo, issuedOn: fromDbDate(main.issuedOn) },
        });
        storageKey = `cases/${enquiry.id}/invoice/${randomUUID()}.pdf`;
        await putObject(storageKey, Buffer.from(pdf.bytes), "application/pdf");

        const family = fileSafeFamilyName(client.name);
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
            kind: "ADDITIONAL",
            invoiceNo,
            enquiryId: enquiry.id,
            issuedOn: toDbDate(issuedOn),
            issuedById: actor.user.id,
            client: main.client as Prisma.InputJsonValue,
            company: view.company as unknown as Prisma.InputJsonValue,
            terms: view.terms,
            placeOfSupply: main.placeOfSupply,
            taxType: main.taxType,
            sac: main.sac,
            gstRateBp: 0,
            processingSpeed: main.processingSpeed,
            grossPaise: totalPaise,
            serviceChargePaise: 0,
            cgstPaise: 0,
            sgstPaise: 0,
            igstPaise: 0,
            totalPaise,
            fileId: file.id,
            charges: { create: charges },
          },
        });
        await audit(
          {
            actorId: actor.user.id,
            action: "visa.additionalInvoice.raise",
            entityType: "Enquiry",
            entityId: enquiry.id,
            clientId: g.clientId,
            after: { invoiceId: invoice.id, invoiceNo, mainInvoiceNo: main.invoiceNo, charges: charges.map((c) => ({ name: c.name, amountPaise: c.amountPaise })), totalPaise, fileId: file.id },
            ip: actor.ip,
          },
          tx,
        );
      },
      // Making the PDF and storing it takes a moment; the case lock is held for it.
      { timeout: 30_000 },
    );
  } catch (err) {
    if (storageKey) {
      const key: string = storageKey;
      await deleteObject(key).catch((cleanupErr) => logger.error({ err: cleanupErr, storageKey: key }, "Couldn't remove an unsaved additional invoice."));
    }
    throw err;
  }
  return getVisaCaseById(enquiry.id);
}
