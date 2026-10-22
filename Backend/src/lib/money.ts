// Money is integer paise (docs/decisions/0009-visa-invoice.md Decision 2): amounts are never floating point, so a quote
// and the invoice copied from it always add up to the same paisa.

const WHOLE_RUPEES = new Intl.NumberFormat("en-IN");

/** 1250000 → "12,500" and 1250050 → "12,500.50": rupees as a message says them, the paise only when there are some. */
export function rupeesText(paise: number) {
  const rest = paise % 100;
  const whole = WHOLE_RUPEES.format((paise - rest) / 100);
  return rest === 0 ? whole : `${whole}.${String(rest).padStart(2, "0")}`;
}

/** 18 → 1800 basis points. The rate setting allows at most 2 decimals. */
export function rateBasisPoints(ratePercent: number) {
  return Math.round(ratePercent * 100);
}

/** GST on an amount in paise, rounded half up to the paisa (0009 Decision 3). */
export function gstPaise(amountPaise: number, ratePercent: number) {
  return Math.floor((amountPaise * rateBasisPoints(ratePercent) + 5000) / 10000);
}

/** Inside Gujarat the tax is CGST + SGST, half each; an odd paisa goes to CGST (0009 Decision 3). */
export function splitIntraState(taxPaise: number) {
  const sgstPaise = Math.floor(taxPaise / 2);
  return { cgstPaise: taxPaise - sgstPaise, sgstPaise };
}

/** One traveller's amount on a quote: a lump sum, or the embassy fee, VFS fee and other. */
export interface QuoteLineAmounts {
  form: "LUMP_SUM" | "ITEMISED";
  lumpSumPaise: number | null;
  embassyFeePaise: number | null;
  vfsFeePaise: number | null;
  otherFeePaise: number | null;
}

export function lineTotalPaise(line: QuoteLineAmounts) {
  return line.form === "LUMP_SUM" ? (line.lumpSumPaise ?? 0) : (line.embassyFeePaise ?? 0) + (line.vfsFeePaise ?? 0) + (line.otherFeePaise ?? 0);
}

/**
 * The quote's totals: the travellers' amounts (passed on, no GST), Masti's service charge, GST on the service charge
 * only, and the total.
 */
export function quoteTotals(lines: QuoteLineAmounts[], serviceChargePaise: number, gstRatePercent: number) {
  const travellersPaise = lines.reduce((sum, line) => sum + lineTotalPaise(line), 0);
  const gst = gstPaise(serviceChargePaise, gstRatePercent);
  return { travellersPaise, serviceChargePaise, gstPaise: gst, totalPaise: travellersPaise + serviceChargePaise + gst };
}
