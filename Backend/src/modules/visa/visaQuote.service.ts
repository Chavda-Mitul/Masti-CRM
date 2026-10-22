import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { assertFresh, staleError } from "../../lib/changes";
import { fieldError } from "../../lib/httpError";
import { quoteTotals, rupeesText, type QuoteLineAmounts } from "../../lib/money";
import { VISA_PRICE } from "../messages/messages.seed";
import { queueMessage } from "../messages/messages.service";
import type { Actor } from "../users/user";
import { INVOICED, loadCase, lockCase } from "./caseLock";
import type { SaveQuoteInput } from "./visa.schemas";
import { getVisaCaseById } from "./visa.service";
import { getVisaSettings } from "./visa.settings";
import { assertQuoteCanChange } from "./visaInvoice.service";
import { visaMessageBasics } from "./visaMessages";

// The quote on a visa case (docs/decisions/0009-visa-invoice.md Decision 2): every amount the invoice will print, per
// traveller a lump sum or itemised, plus Masti's service charge. Money is in paise. Saved whole, by whoever can act on
// the case, from Step 1 until the file goes to the vendor. A raised invoice freezes it; a credit note cancelling it
// reopens it at any step, for the corrected invoice (docs/decisions/0011-visa-at-vendor.md Decision 5).

/** The quote's own token: null means "there was no quote when I opened it". */
function assertQuoteFresh(existing: { updatedAt: Date } | null, sent: string | null) {
  if (!existing) {
    if (sent !== null) throw staleError("quote");
    return;
  }
  if (sent === null) throw staleError("quote");
  assertFresh(existing.updatedAt, sent, "quote");
}

type QuoteRow = {
  processingSpeedId: number;
  serviceChargePaise: number;
  lines: {
    travellerId: string;
    form: string;
    lumpSumPaise?: number | null;
    embassyFeePaise?: number | null;
    vfsFeePaise?: number | null;
    otherFeePaise?: number | null;
  }[];
};

/** A saved line's amounts, as the totals read them. */
function amountsOf(line: SaveQuoteInput["lines"][number]): QuoteLineAmounts {
  return line.form === "LUMP_SUM"
    ? { form: line.form, lumpSumPaise: line.lumpSumPaise, embassyFeePaise: null, vfsFeePaise: null, otherFeePaise: null }
    : { form: line.form, lumpSumPaise: null, embassyFeePaise: line.embassyFeePaise, vfsFeePaise: line.vfsFeePaise, otherFeePaise: line.otherFeePaise };
}

/** The quote as audited and compared: lines in a fixed order, every amount present (null when not used). */
function snapshot(q: QuoteRow) {
  return {
    processingSpeedId: q.processingSpeedId,
    serviceChargePaise: q.serviceChargePaise,
    lines: [...q.lines]
      .sort((a, b) => a.travellerId.localeCompare(b.travellerId))
      .map((l) => ({
        travellerId: l.travellerId,
        form: l.form,
        lumpSumPaise: l.lumpSumPaise ?? null,
        embassyFeePaise: l.embassyFeePaise ?? null,
        vfsFeePaise: l.vfsFeePaise ?? null,
        otherFeePaise: l.otherFeePaise ?? null,
      })),
  };
}

/**
 * Saves the whole quote. The lines must be exactly the case's travellers. A new processing speed must be active; one
 * switched off since it was picked can be kept. Nothing is written or audited when nothing changed. The case's
 * updatedAt doesn't move (like trip details), so it never makes someone else's open page stale; the quote has its own
 * token instead.
 */
export async function saveQuote(caseNo: string, input: SaveQuoteInput, actor: Actor) {
  const enquiry = await loadCase(caseNo, actor, INVOICED);
  assertQuoteFresh(await prisma.visaQuote.findUnique({ where: { enquiryId: enquiry.id }, select: { updatedAt: true } }), input.updatedAt);

  await prisma.$transaction(async (tx) => {
    const locked = await lockCase(tx, enquiry.id, actor, INVOICED);
    await assertQuoteCanChange(tx, enquiry.id, locked.stage.code);
    const before = await tx.visaQuote.findUnique({ where: { enquiryId: enquiry.id }, include: { lines: true } });
    assertQuoteFresh(before, input.updatedAt);

    const travellers = await tx.visaCaseTraveller.findMany({ where: { caseId: enquiry.id }, select: { id: true } });
    const ids = new Set(travellers.map((t) => t.id));
    const sent = input.lines.map((l) => l.travellerId);
    if (sent.length !== ids.size || new Set(sent).size !== sent.length || sent.some((id) => !ids.has(id))) {
      throw fieldError("lines", "Give every traveller an amount.");
    }

    if (input.processingSpeedId !== before?.processingSpeedId) {
      const speed = await tx.processingSpeed.findUnique({ where: { id: input.processingSpeedId }, select: { isActive: true } });
      if (!speed?.isActive) throw fieldError("processingSpeedId", "Pick a processing speed from the list.");
    }

    const after = snapshot(input);
    const previous = before && snapshot(before);
    if (previous && JSON.stringify(previous) === JSON.stringify(after)) return;

    const data = { processingSpeedId: input.processingSpeedId, serviceChargePaise: input.serviceChargePaise, updatedById: actor.user.id };
    await tx.visaQuote.upsert({ where: { enquiryId: enquiry.id }, create: { enquiryId: enquiry.id, ...data }, update: data });
    await tx.visaQuoteLine.deleteMany({ where: { enquiryId: enquiry.id } });
    await tx.visaQuoteLine.createMany({
      data: input.lines.map((l) =>
        l.form === "LUMP_SUM"
          ? { enquiryId: enquiry.id, travellerId: l.travellerId, form: l.form, lumpSumPaise: l.lumpSumPaise }
          : {
              enquiryId: enquiry.id,
              travellerId: l.travellerId,
              form: l.form,
              embassyFeePaise: l.embassyFeePaise,
              vfsFeePaise: l.vfsFeePaise,
              otherFeePaise: l.otherFeePaise,
            },
      ),
    });
    await audit(
      {
        actorId: actor.user.id,
        action: "visa.quote.save",
        entityType: "Enquiry",
        entityId: enquiry.id,
        clientId: enquiry.clientId,
        before: previous,
        after,
        ip: actor.ip,
      },
      tx,
    );
    // Message 2, "Your price": the first time the case has a price. A later change sends nothing; the invoice
    // (message 7) carries the final amount.
    if (!before) {
      const { gstRatePercent } = (await getVisaSettings(tx)).invoice;
      const { totalPaise } = quoteTotals(input.lines.map(amountsOf), input.serviceChargePaise, gstRatePercent);
      const basics = await visaMessageBasics(tx, enquiry.id);
      await queueMessage(tx, {
        template: VISA_PRICE,
        enquiryId: enquiry.id,
        key: `${VISA_PRICE}:${enquiry.id}`,
        clientId: basics.clientId,
        variables: { ...basics.variables, total: rupeesText(totalPaise) },
      });
    }
  });
  return getVisaCaseById(enquiry.id);
}
