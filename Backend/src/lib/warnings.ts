import { HttpError } from "./httpError";

// Soft warnings (decided 19 Oct 2026, project lead; M46 asks Vimal to confirm). Some inputs are usually a mistake but can
// be right: a visa that ends before the trip, an appointment after departure, a passport about to expire, an adult in a
// child's place, a child collecting the passports. The first save answers 409 { code: "WARNING", warnings }; staff check
// and send the same request again with confirmWarnings: true. The confirmation is written to the audit log. The same
// flow as the duplicate-client warning (clients/duplicates.ts).

export interface Warning {
  /** Machine-readable, e.g. "VISA_DATES_TRIP"; the audit keeps these. */
  code: string;
  /** What to check, in plain words, naming the traveller and the dates. */
  message: string;
}

/** Throws 409 WARNING with every warning found, unless the request confirmed them. Returns them, for the audit entry. */
export function checkWarnings(warnings: Warning[], confirmed: boolean): Warning[] {
  if (warnings.length > 0 && !confirmed) {
    const message = warnings.length === 1 ? warnings[0]!.message : `${warnings.length} things to check before saving.`;
    throw new HttpError(409, `${message} Check, then save again to confirm.`, { code: "WARNING", warnings });
  }
  return warnings;
}

/** Merged into the audit "after" when staff saved past a warning. */
export function confirmedWarningsNote(confirmed: Warning[]) {
  return confirmed.length > 0 ? { confirmedWarnings: confirmed } : {};
}
