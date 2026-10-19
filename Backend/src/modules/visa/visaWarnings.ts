import type { Db } from "../../config/prisma";
import { addMonths, dateLabel, fromDbDate } from "../../lib/dates";
import type { Warning } from "../../lib/warnings";
import { getVisaSettings } from "./visa.settings";

// A visa case's soft warnings about its travellers (decided 19 Oct 2026, M46; lib/warnings.ts): things that are usually
// a mistake but can be right, so staff confirm them rather than being stopped.

/** A traveller as these checks need them: the name on the case, and the family member's passport and birth date. */
export interface TravellerPapers {
  name: string | null;
  member: { name: string; passportExpiry: Date | null; dateOfBirth?: Date | null } | null;
}

/** The member select for TravellerPapers. */
export const travellerPapersSelect = { name: true, member: { select: { name: true, passportExpiry: true, dateOfBirth: true } } } as const;

/**
 * A passport that runs out less than ⚠️ visa.passportValidity months (seeded 6) after the trip comes back: many embassies
 * refuse it. `returnOn` is the return as it will be saved; no return yet, or no expiry on file, isn't checked.
 */
export async function passportWarnings(db: Db, returnOn: string | null, travellers: TravellerPapers[]): Promise<Warning[]> {
  if (!returnOn) return [];
  const months = (await getVisaSettings(db)).passportValidity.monthsAfterReturn;
  const needed = addMonths(returnOn, months);
  return travellers.flatMap((t) => {
    const expiry = t.member?.passportExpiry ? fromDbDate(t.member.passportExpiry) : null;
    if (!t.member || !expiry || expiry >= needed) return [];
    return [
      {
        code: "PASSPORT_EXPIRES_SOON",
        message: `${t.name ?? t.member.name}'s passport expires ${dateLabel(expiry)}, less than ${months} month${months === 1 ? "" : "s"} after the trip comes back (${dateLabel(returnOn)}).`,
      },
    ];
  });
}
