// Money is integer paise (docs/decisions/0009-visa-invoice.md Decision 2), the same as the API: amounts are shown in
// rupees and typed in rupees, but never kept as floating point.

const RUPEES = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** 341000 → "₹3,410.00" */
export function formatRupees(paise: number): string {
  return RUPEES.format(paise / 100)
}

/**
 * What was typed, in paise: "3,410.50" → 341050. Blank is null; anything else that isn't a plain amount with at most
 * 2 decimals is undefined.
 */
export function parseRupees(text: string): number | null | undefined {
  const t = text.replace(/[\s,₹]/g, '')
  if (t === '') return null
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return undefined
  const [rupees = '0', paise = ''] = t.split('.')
  return Number(rupees) * 100 + Number(paise.padEnd(2, '0'))
}

/** 341050 → "3410.50" and 341000 → "3410", for an input box; null → "". */
export function rupeesInput(paise: number | null): string {
  if (paise === null) return ''
  const rupees = Math.floor(paise / 100)
  const rest = paise % 100
  return rest === 0 ? String(rupees) : `${rupees}.${String(rest).padStart(2, '0')}`
}

/** GST on an amount in paise, rounded half up to the paisa: the same sum as the backend's src/lib/money.ts. */
export function gstPaise(amountPaise: number, ratePercent: number): number {
  return Math.floor((amountPaise * Math.round(ratePercent * 100) + 5000) / 10000)
}
