import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { assertFresh } from "../../lib/changes";
import { conflict, fieldError, forbidden, HttpError } from "../../lib/httpError";
import { isHodOf } from "../auth/permissions";
import type { Actor, UserWithDepartments } from "../users/user";
import { findVisibleCase, loadCase, lockCase, RECALLING, visaStage } from "./caseLock";
import type { InvoiceImages } from "./invoicePdf";
import type { RecallInput } from "./visa.schemas";
import { getVisaCaseById } from "./visa.service";
import { dueOnOfficeDay, getVisaSettings } from "./visa.settings";
import {
  cancellationOf,
  creditBlockers,
  creditImages,
  gatherForCredit,
  issueCreditNote,
  nextCreditNoteNo,
  withCreditNoteNumber,
  type CreditDraft,
  type CreditInvoice,
} from "./visaCreditNote.service";

// Taking a file back from the vendor (docs/decisions/0011-visa-at-vendor.md Decision 6): when the embassy will take
// longer than the client can wait. Any time at At vendor, before or after the embassy submission; whoever can act on the
// case recalls it, with a reason from the recall-reasons list. A PART credit note gives back each traveller's embassy
// fee (nothing on a lump sum); VFS, Masti's service charge and the courier are kept. Only the Visa HOD or the Head can
// give back more ("Change refund (HOD)"), per traveller up to what they were charged, never the service charge, so the
// note carries no GST. The case goes to Passport back, marked Recalled, due the next office day ⚠️ (visa.recallReturn)
// to chase the vendor for the papers. A cancelled case is recalled too, so its passports still come back
// (docs/decisions/0006-visa-documents.md amendment 15).

const VISA = "VISA";

/** The case's standing invoice and what a credit note against it prints, its file, its status and the recall's timing. */
async function gather(enquiryId: string, db: Db) {
  const [credit, visa, enquiry, settings] = await Promise.all([
    gatherForCredit(enquiryId, db),
    db.visaCase.findUniqueOrThrow({ where: { enquiryId }, select: { docketId: true } }),
    db.enquiry.findUniqueOrThrow({ where: { id: enquiryId }, select: { status: true } }),
    getVisaSettings(db),
  ]);
  return { ...credit, visa, status: enquiry.status, recallReturn: settings.recallReturn };
}

type Gathered = Awaited<ReturnType<typeof gather>>;

/** Each traveller's line, what they were charged and what goes back by default: the embassy fee, or nothing on a lump sum. */
function refundLines(inv: CreditInvoice) {
  return inv.lines.map((l) => ({
    position: l.position,
    name: l.name,
    form: l.form,
    embassyFeePaise: l.embassyFeePaise,
    chargedPaise: l.totalPaise,
    defaultRefundPaise: l.form === "ITEMISED" ? (l.embassyFeePaise ?? 0) : 0,
  }));
}

/** A file that went in a docket to a vendor (an e-visa has nothing to take back). */
function assertRecallable(g: Gathered) {
  if (!g.visa.docketId) throw conflict("This file went in online: there's nothing to take back from a vendor.");
}

/**
 * The invoice a recall gives back from: the case's standing one. A cancelled case whose invoice was already cancelled
 * whole (no replacement) has none, and its recall gives nothing back (0006 amendment 15); an open case raises the
 * corrected one first.
 */
function recallInvoice(g: Gathered) {
  const inv = g.invoice;
  if (inv && !cancellationOf(inv)) return inv;
  if (g.status === "CANCELLED") return null;
  throw conflict("This file has no standing invoice: raise the corrected one first.");
}

/**
 * For the recall dialog: each traveller's default refund, the total, the number its credit note would get, and when it's
 * due back. With no invoice to give back from (a cancelled case, above), `invoiceNo` is null and nothing goes back.
 */
export async function recallCheck(caseNo: string, user: UserWithDepartments) {
  const { id } = await findVisibleCase(caseNo, user);
  const g = await gather(id, prisma);
  assertRecallable(g);
  const inv = recallInvoice(g);
  const lines = inv ? refundLines(inv) : [];
  return {
    invoiceNo: inv?.invoiceNo ?? null,
    lines,
    defaultTotalPaise: lines.reduce((n, l) => n + l.defaultRefundPaise, 0),
    canChangeRefund: !!inv && isHodOf(user, VISA),
    creditNoteNo: inv ? await nextCreditNoteNo(g, prisma) : null,
    dueAt: await dueOnOfficeDay(g.recallReturn),
    blockers: inv ? creditBlockers(g, user.name) : [],
  };
}

/** What goes back per traveller: the defaults, or the HOD's refunds, each between the default and what was charged. */
function refundsOf(inv: CreditInvoice, input: RecallInput, actor: Actor) {
  const lines = refundLines(inv);
  const sent = new Map((input.refunds ?? []).map((r) => [r.position, r.refundPaise]));
  if ([...sent.keys()].some((position) => !lines.some((l) => l.position === position))) {
    throw fieldError("refunds", "Give refunds only for the invoice's travellers.");
  }
  const refunds = lines.map((l) => ({ ...l, refundPaise: sent.get(l.position) ?? l.defaultRefundPaise }));
  for (const r of refunds) {
    if (r.refundPaise < r.defaultRefundPaise) throw fieldError("refunds", `${r.name}: the embassy fee always goes back.`);
    if (r.refundPaise > r.chargedPaise) throw fieldError("refunds", `${r.name}: no more than they were charged goes back.`);
  }
  const changed = refunds.some((r) => r.refundPaise > r.defaultRefundPaise);
  if (changed && !isHodOf(actor.user, VISA)) throw forbidden("Only the Visa HOD or the Head can give back more than the embassy fee.");
  return { refunds, changed, totalPaise: refunds.reduce((n, r) => n + r.refundPaise, 0) };
}

/** The PART credit note's draft: one LUMP_SUM line per traveller something goes back for; no service charge, no GST. */
function partDraft(inv: CreditInvoice, refunds: ReturnType<typeof refundsOf>["refunds"], recallReason: string, creditReason: { id: number; code: string; name: string }): CreditDraft {
  const lines = refunds
    .filter((r) => r.refundPaise > 0)
    .map((r) => {
      const line = inv.lines.find((l) => l.position === r.position)!;
      return {
        invoicePosition: line.position,
        name: line.name,
        description: line.description,
        form: "LUMP_SUM" as const,
        lumpSumPaise: r.refundPaise,
        embassyFeePaise: null,
        vfsFeePaise: null,
        otherFeePaise: null,
        totalPaise: r.refundPaise,
      };
    });
  const total = lines.reduce((n, l) => n + l.totalPaise, 0);
  return {
    kind: "PART",
    reason: creditReason,
    printedReason: `${creditReason.name} · ${recallReason}`,
    lines,
    grossPaise: total,
    serviceChargePaise: 0,
    cgstPaise: 0,
    sgstPaise: 0,
    igstPaise: 0,
    totalPaise: total,
  };
}

/**
 * "Take the file back" (Decision 6). In one transaction under the case lock: the case moves to Passport back, due the
 * next office day; the recall is stamped with who, when and why; when anything goes back, a PART credit note is issued
 * (PDF, number, file, rows, audit); and the recall is audited with the refunds and whether the HOD changed them. On an
 * open or a cancelled case (RECALLING); a cancelled one with no invoice left to give back from gives nothing back.
 */
export async function recallFile(caseNo: string, input: RecallInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, RECALLING);
  assertFresh(enquiry.updatedAt, input.updatedAt, "case");
  const check = async (g: Gathered, db: Db) => {
    assertRecallable(g);
    const inv = recallInvoice(g);
    if ((inv?.invoiceNo ?? null) !== input.invoiceNo) {
      throw new HttpError(409, "This file's invoice changed after this opened. Look at it again.", { code: "RECALL_CHANGED" });
    }
    const reason = await db.recallReason.findUnique({ where: { id: input.reasonId } });
    if (!reason?.isActive) throw fieldError("reasonId", "Pick an active reason.");
    if (!inv && (input.refunds ?? []).length > 0) throw fieldError("refunds", "Nothing goes back: this file's invoice was already cancelled.");
    const refund = inv ? refundsOf(inv, input, actor) : { refunds: [] as ReturnType<typeof refundsOf>["refunds"], changed: false, totalPaise: 0 };
    if (refund.totalPaise > 0) {
      const blockers = creditBlockers(g, actor.user.name);
      if (blockers.length) throw new HttpError(409, "The credit note can't be issued yet.", { code: "RECALL_BLOCKED", blockers });
    }
    return { inv, reason, ...refund };
  };
  const pre = await gather(enquiry.id, prisma);
  const preview = await check(pre, prisma);
  const images: InvoiceImages = preview.totalPaise > 0 ? await creditImages(pre) : { logo: null, signature: null };
  // The credit note's own reason is always "Recall"; why the file came back is the recall's reason.
  const creditReason = await prisma.creditNoteReason.findUnique({ where: { code: "RECALL" } });
  if (!creditReason) throw new HttpError(500, "The credit-note reason Recall is missing. Run the database seed.");

  await withCreditNoteNumber((upload) =>
    prisma.$transaction(
      async (tx) => {
        const locked = await lockCase(tx, enquiry.id, actor, RECALLING);
        assertFresh(locked.updatedAt, input.updatedAt, "case");
        const g = await gather(enquiry.id, tx);
        const { inv, reason, refunds, changed, totalPaise } = await check(g, tx);

        const dueAt = await dueOnOfficeDay(g.recallReturn, tx);
        const passportBack = await visaStage(tx, locked.departmentId, "PASSPORT_BACK");
        await tx.enquiry.update({ where: { id: enquiry.id }, data: { stageId: passportBack.id, dueAt } });
        await tx.visaCase.update({
          where: { enquiryId: enquiry.id },
          data: { recalledAt: new Date(), recalledById: actor.user.id, recallReasonId: reason.id },
        });
        const note =
          inv && totalPaise > 0
            ? await issueCreditNote(tx, { enquiryId: enquiry.id, g, inv, draft: partDraft(inv, refunds, reason.name, creditReason), images, actor, upload })
            : null;
        await audit(
          {
            actorId: actor.user.id,
            action: "visa.recall",
            entityType: "Enquiry",
            entityId: enquiry.id,
            clientId: enquiry.clientId,
            before: { stage: "AT_VENDOR", dueAt: locked.dueAt },
            after: {
              stage: "PASSPORT_BACK",
              dueAt,
              reason: reason.code,
              refunds: refunds.map((r) => ({ position: r.position, refundPaise: r.refundPaise })),
              changedByHod: changed,
              creditNoteNo: note?.creditNoteNo ?? null,
              totalPaise,
            },
            ip: actor.ip,
          },
          tx,
        );
      },
      // Making the PDF and storing it takes a moment; the case lock is held for it.
      { timeout: 30_000 },
    ),
  );
  return getVisaCaseById(enquiry.id);
}
