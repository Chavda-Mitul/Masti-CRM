import type { EntryType } from "../../../generated/prisma/enums";
import { dateLabel, daysInclusive, fullDate } from "../../lib/dates";

// Filling a covering letter's {blanks} in from a case (docs/decisions/0019-covering-letters.md Decisions 4 and 9). No
// queries here: the case's details come in as LetterFacts, so the rules are tested on their own. Only the blanks a
// wording uses can be missing; the letter isn't made until nothing is (Decision 9).

/** What a case brings to its letter. Dates are YYYY-MM-DD (India). */
export interface LetterFacts {
  clientName: string;
  /** One line, "" when the client has no address yet. */
  clientAddress: string;
  country: string;
  visaType: string;
  trip: { departOn: string | null; returnOn: string | null; entryType: EntryType | null; hotelStay: string | null };
  /** In their order on the case: the first is the applicant. */
  travellers: {
    /** The passport name; null only before the traveller is linked to a family member. */
    name: string | null;
    /** "Adult 1": what a message calls a traveller with no name. */
    label: string;
    relation: string | null;
    dateOfBirth: string | null;
    passportNumber: string | null;
  }[];
}

/** One row of the table {travellers} prints. */
export interface LetterRow {
  name: string;
  relation: string;
  dateOfBirth: string;
  passportNo: string;
}

/** What the letter prints: each blank's words, and the table's rows. Also what a made letter keeps (its snapshot). */
export interface LetterFill {
  values: Record<string, string>;
  travellers: LetterRow[];
}

const ENTRY_WORD: Record<EntryType, string> = { SINGLE: "single", DOUBLE: "double", MULTIPLE: "multiple" };

/** "A", "A and B", "A, B and C". */
export function namesInASentence(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** The blanks a wording uses. */
function blanksIn(body: string): Set<string> {
  return new Set([...body.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]!));
}

/**
 * Fills a wording in for a case on a day (the letter's date). A blank the wording uses and the case can't fill is left
 * out of `values` and listed in `missing`, in plain words ("Diya Mehta's passport number", "the hotel stay").
 */
export function fillLetter(body: string, facts: LetterFacts, day: string): LetterFill & { missing: string[] } {
  const used = blanksIn(body);
  const values: Record<string, string> = {};
  const missing = new Set<string>();
  const put = (blank: string, value: string | null | undefined, what: string) => {
    if (!used.has(blank)) return;
    if (value) values[blank] = value;
    else missing.add(what);
  };

  const { trip } = facts;
  const nameOf = (t: LetterFacts["travellers"][number]) => t.name ?? t.label;
  const first = facts.travellers[0];

  put("date", fullDate(day), "the date");
  put("clientName", facts.clientName, "the client's name");
  put("clientAddress", facts.clientAddress, "the client's address");
  put("applicant", first?.name, "the first traveller's name");
  put("passportNo", first?.passportNumber, `${first ? nameOf(first) : "the first traveller"}'s passport number`);
  put("travellerNames", namesInASentence(facts.travellers.map(nameOf)), "the travellers' names");
  put("travellerCount", String(facts.travellers.length), "the number of travellers");
  put("country", facts.country, "the country");
  put("visaType", facts.visaType, "the visa type");
  put("departOn", trip.departOn && fullDate(trip.departOn), "travelling out");
  put("returnOn", trip.returnOn && fullDate(trip.returnOn), "coming back");
  if (used.has("days")) {
    if (trip.departOn && trip.returnOn) values.days = String(daysInclusive(trip.departOn, trip.returnOn));
    if (!trip.departOn) missing.add("travelling out");
    if (!trip.returnOn) missing.add("coming back");
  }
  put("entry", trip.entryType && ENTRY_WORD[trip.entryType], "the entry type");
  put("hotel", trip.hotelStay, "the hotel stay");

  const travellers: LetterRow[] = [];
  if (used.has("travellers")) {
    for (const t of facts.travellers) {
      const name = nameOf(t);
      if (!t.name) missing.add(`${name}'s name`);
      if (!t.dateOfBirth) missing.add(`${name}'s date of birth`);
      if (!t.passportNumber) missing.add(`${name}'s passport number`);
      travellers.push({
        name,
        relation: t.relation ?? "",
        dateOfBirth: t.dateOfBirth ? dateLabel(t.dateOfBirth) : "",
        passportNo: t.passportNumber ?? "",
      });
    }
  }

  return { values, travellers, missing: [...missing] };
}
