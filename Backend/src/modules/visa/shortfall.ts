import { conflict } from "../../lib/httpError";

// A short return (docs/decisions/0013-visa-passport-back.md Decision 5, amended 17 Oct 2026): fewer current or old
// booklets came back than went out. Until the rest come in ("Received the rest") or the shortfall is cleared with a
// reason, the handover (and its photo) and booking the delivery boy wait.

/** A case's booklet counts: at intake (null when nobody counted), at receipt (null until received), and its travellers. */
export interface BookletCounts {
  bookletsCurrent: number | null;
  bookletsOld: number | null;
  bookletsBackCurrent: number | null;
  bookletsBackOld: number | null;
  travellerCount: number;
}

/** What went to the vendor, as the docket counted it (0008 Decision 4): the current booklets (else one per traveller) and the old ones. */
export function bookletsSent(v: Pick<BookletCounts, "bookletsCurrent" | "bookletsOld" | "travellerCount">) {
  return { current: v.bookletsCurrent ?? v.travellerCount, old: v.bookletsOld ?? 0 };
}

/** Once received: per kind, how many of the booklets that went out aren't in our stock. Never below 0: an extra one isn't held. */
export function missingBooklets(v: BookletCounts) {
  const sent = bookletsSent(v);
  return {
    current: Math.max(0, sent.current - (v.bookletsBackCurrent ?? 0)),
    old: Math.max(0, sent.old - (v.bookletsBackOld ?? 0)),
  };
}

/** "1 old passport is missing", "2 current passports are missing", "2 passports are missing (1 current, 1 old)". */
export function missingText(m: { current: number; old: number }) {
  const total = m.current + m.old;
  const noun = total === 1 ? "passport is" : "passports are";
  if (m.current > 0 && m.old > 0) return `${total} ${noun} missing (${m.current} current, ${m.old} old)`;
  return `${total} ${m.current > 0 ? "current" : "old"} ${noun} missing`;
}

/** What's missing while it holds the case: received, short, and not cleared. Null when nothing holds it. */
export function heldShort(v: BookletCounts & { passportsReceivedAt: Date | null; shortfallClearedAt: Date | null }) {
  if (!v.passportsReceivedAt || v.shortfallClearedAt) return null;
  const m = missingBooklets(v);
  return m.current + m.old > 0 ? m : null;
}

/** Refuses the handover, its photo and booking a delivery while a short return holds the case. */
export function assertNotHeldShort(v: Parameters<typeof heldShort>[0]) {
  const m = heldShort(v);
  if (!m) return;
  const them = m.current + m.old === 1 ? "it when it comes" : "them when they come";
  throw conflict(`${missingText(m)}: record ${them}, or clear the shortfall first.`);
}
