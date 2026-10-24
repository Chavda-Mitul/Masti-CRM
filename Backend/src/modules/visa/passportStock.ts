import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../config/prisma";
import { heldAtOffice, TO_HAND_BACK } from "../enquiries/visibility";
import { bookletsSent, heldShort } from "./shortfall";

// The passport booklets we hold, office-wide (change request 23, docs/decisions/0017-today-dashboard.md amendment 3),
// on Today for the Head and the Visa HOD. Every case whose passports are still to hand back (TO_HAND_BACK) has them in
// one place:
// - in our office: counted in at intake and not sent (before dispatch, a cancelled case's, an e-visa's), as counted
//   then; or back from the vendor, as counted at "Mark received" (plus "Received the rest")
// - with the vendor: in a dispatched docket, a recalled file's too, as the docket counted them (bookletsSent)
// - on the way back: marked in transit, not yet received
// A short return's missing booklets aren't in the office: they're counted apart until found or cleared. A handover takes
// the case out. Before dispatch, only a case whose booklets were counted is counted.

export type Booklets = { current: number; old: number };
export type PassportPlace = "OFFICE" | "WITH_VENDOR" | "ON_THE_WAY_BACK";

const stockSelect = {
  stage: { select: { code: true } },
  visa: {
    select: {
      bookletsCurrent: true,
      bookletsOld: true,
      bookletsBackCurrent: true,
      bookletsBackOld: true,
      submittedOnlineAt: true,
      passportsInTransitAt: true,
      passportsReceivedAt: true,
      shortfallClearedAt: true,
      handover: { select: { enquiryId: true } },
      docket: { select: { dispatchedAt: true } },
      _count: { select: { travellers: true } },
    },
  },
} satisfies Prisma.EnquirySelect;

type StockRow = Prisma.EnquiryGetPayload<{ select: typeof stockSelect }>;

/** Where a case's booklets are, how many, and what a short return still misses; null once they're the client's again. */
export function placeOf(e: StockRow): { place: PassportPlace; booklets: Booklets; missing: Booklets | null } | null {
  const v = e.visa;
  if (!v || v.handover) return null;
  if (v.docket?.dispatchedAt) {
    const counts = { ...v, travellerCount: v._count.travellers };
    if (v.passportsReceivedAt) {
      return { place: "OFFICE", booklets: { current: v.bookletsBackCurrent ?? 0, old: v.bookletsBackOld ?? 0 }, missing: heldShort(counts) };
    }
    return { place: v.passportsInTransitAt ? "ON_THE_WAY_BACK" : "WITH_VENDOR", booklets: bookletsSent(counts), missing: null };
  }
  if (heldAtOffice(e)) return { place: "OFFICE", booklets: { current: v.bookletsCurrent ?? 0, old: v.bookletsOld ?? 0 }, missing: null };
  return null;
}

/** Today's passport card: the booklets in our office, with the vendors, on the way back, and missing from short returns. */
export async function passportStock() {
  const rows = await prisma.enquiry.findMany({ where: TO_HAND_BACK, select: stockSelect });
  const zero = (): Booklets => ({ current: 0, old: 0 });
  const stock = { inOffice: zero(), withVendors: zero(), onTheWayBack: zero(), missing: zero() };
  const add = (to: Booklets, b: Booklets) => {
    to.current += b.current;
    to.old += b.old;
  };
  const total: Record<PassportPlace, Booklets> = { OFFICE: stock.inOffice, WITH_VENDOR: stock.withVendors, ON_THE_WAY_BACK: stock.onTheWayBack };
  for (const row of rows) {
    const at = placeOf(row);
    if (!at) continue;
    add(total[at.place], at.booklets);
    if (at.missing) add(stock.missing, at.missing);
  }
  return stock;
}
