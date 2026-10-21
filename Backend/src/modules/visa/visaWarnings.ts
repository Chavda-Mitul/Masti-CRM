import type { Db } from "../../config/prisma";
import { addMonths, dateLabel, dayLabel, fromDbDate, istToday, wholeYearsBetween } from "../../lib/dates";
import type { Warning } from "../../lib/warnings";
import { getVisaSettings } from "./visa.settings";
import { countTravellers, travellerLabel } from "./visaCase";

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

/**
 * An adult in a child's place on the case, or a child in an adult's: each place has its own checklist. Staff decide who
 * is a child (0005, 0006); the age only catches a slip. Counted on `on` (the departure day, else today) against ⚠️
 * visa.childAge (seeded 18). No birth date on file isn't checked.
 */
export async function ageWarnings(db: Db, on: string, travellers: { isChild: boolean; papers: TravellerPapers }[]): Promise<Warning[]> {
  const adultFrom = (await getVisaSettings(db)).childAge.adultFrom;
  return travellers.flatMap(({ isChild, papers: t }) => {
    const born = t.member?.dateOfBirth ? fromDbDate(t.member.dateOfBirth) : null;
    if (!t.member || !born) return [];
    const age = wholeYearsBetween(born, on);
    const name = t.name ?? t.member.name;
    if (isChild && age >= adultFrom) {
      return [{ code: "ADULT_IN_CHILD_PLACE", message: `${name} is ${age}, but this is a child's place on the case, with a child's checklist.` }];
    }
    if (!isChild && age < adultFrom) {
      return [{ code: "CHILD_IN_ADULT_PLACE", message: `${name} is ${age}, but this is an adult's place on the case, with an adult's checklist.` }];
    }
    return [];
  });
}

/** A traveller's embassy appointment, named as the case names them: the passport name, else "Adult 1". */
export interface NamedAppointment {
  name: string;
  appointmentAt: Date | null;
}

/** What namedAppointments needs of each traveller. */
export const appointmentSelect = { name: true, position: true, isChild: true, appointmentAt: true } as const;

/** Every traveller of the case (all of them, so "Adult 2" counts right), named for appointmentWarnings. */
export function namedAppointments(rows: { name: string | null; position: number; isChild: boolean; appointmentAt: Date | null }[]): NamedAppointment[] {
  const { adults } = countTravellers(rows);
  return rows.map((t) => ({ name: t.name ?? travellerLabel(t, adults), appointmentAt: t.appointmentAt }));
}

/**
 * An appointment on or after the day the trip begins can't bring the visa in time; it can still be right if the trip
 * moves (decided 19 Oct 2026). Checked when an appointment is saved, when travelling out moves, and at File ready
 * (21 Oct 2026: moving the trip used to skip it). No departure yet, or no appointment, isn't checked.
 */
export function appointmentWarnings(departOn: string | null, travellers: NamedAppointment[]): Warning[] {
  if (!departOn) return [];
  return travellers.flatMap((t) => {
    const on = t.appointmentAt && istToday(t.appointmentAt);
    if (!on || on < departOn) return [];
    return [
      {
        code: "APPOINTMENT_ON_OR_AFTER_DEPARTURE",
        message: `${t.name}'s appointment (${dayLabel(on)}) is on or after the day the trip begins (${dayLabel(departOn)}).`,
      },
    ];
  });
}

/**
 * The passports collected from the embassy on or after the day the trip begins: the client would travel without them
 * (21 Oct 2026). It can still be right if the trip moves, so it's a warning. No departure on file isn't checked.
 */
export function collectionWarnings(departOn: string | null, collectionOn: string): Warning[] {
  if (!departOn || collectionOn < departOn) return [];
  return [
    {
      code: "COLLECTION_ON_OR_AFTER_DEPARTURE",
      message: `The expected collection date (${dayLabel(collectionOn)}) is on or after the day the trip begins (${dayLabel(departOn)}).`,
    },
  ];
}
