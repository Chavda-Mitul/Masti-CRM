import type { EntryType } from "../../../generated/prisma/enums";
import { dateLabel, daysInclusive, fullDate } from "../../lib/dates";
import { mark, normaliseLetterPart, PURPOSE_MARK, type LetterBlank, type LetterText } from "./coveringLetters.schemas";

// Drafting a case's covering letter from a wording (docs/decisions/0019-covering-letters.md Decisions 4 and 8, amendment
// 1). No queries here: the case's details come in as LetterFacts, so the rules are tested on their own. Only the blanks
// a wording uses are filled. One the case can't fill becomes a mark in plain words (⟦the hotel stay⟧) that staff type
// over before the letter is made, and is listed in `missing` so it can be added to the case too.

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

/** The table {travellers} starts as. Staff may change its headings, rows and columns. */
export const TRAVELLER_COLUMNS = ["Name", "Relation", "Date of birth", "Passport no."];

const ENTRY_WORD: Record<EntryType, string> = { SINGLE: "single", DOUBLE: "double", MULTIPLE: "multiple" };

/** {travellers} alone on its line: where the table goes. */
const TRAVELLERS_LINE = /^[ \t]*\{travellers\}[ \t]*$/;

/** "A", "A and B", "A, B and C". */
export function namesInASentence(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * Drafts the letter for a case on a day (the letter's date): each blank the wording uses becomes the case's value, or a
 * mark where the case lacks it. `missing` says, in plain words, what the case lacks ("Diya Mehta's passport number").
 */
export function draftLetter(body: string, facts: LetterFacts, day: string): { letter: LetterText; missing: string[] } {
  const missing = new Set<string>();
  const { trip } = facts;
  const first = facts.travellers[0];
  const whoIs = (t: LetterFacts["travellers"][number]) => t.name ?? t.label;
  /** The value, or a mark with the same words as `missing`. */
  const valueOr = (value: string | null | undefined, what: string) => {
    if (value) return value;
    missing.add(what);
    return mark(what);
  };
  const nameOf = (t: LetterFacts["travellers"][number]) => valueOr(t.name, `${t.label}'s name`);

  // Every blank has its entry: one left out is a type error, not a {blank} printed as written.
  const blanks: Record<LetterBlank, () => string> = {
    date: () => fullDate(day),
    clientName: () => valueOr(facts.clientName, "the client's name"),
    clientAddress: () => valueOr(facts.clientAddress, "the client's address"),
    applicant: () => valueOr(first?.name, "the first traveller's name"),
    passportNo: () => valueOr(first?.passportNumber, `${first ? whoIs(first) : "the first traveller"}'s passport number`),
    travellerNames: () => namesInASentence(facts.travellers.map(nameOf)),
    travellerCount: () => String(facts.travellers.length),
    country: () => valueOr(facts.country, "the country"),
    visaType: () => valueOr(facts.visaType, "the visa type"),
    departOn: () => valueOr(trip.departOn && fullDate(trip.departOn), "travelling out"),
    returnOn: () => valueOr(trip.returnOn && fullDate(trip.returnOn), "coming back"),
    days: () => {
      if (trip.departOn && trip.returnOn) return String(daysInclusive(trip.departOn, trip.returnOn));
      if (!trip.departOn) missing.add("travelling out");
      if (!trip.returnOn) missing.add("coming back");
      return mark("the number of days");
    },
    entry: () => valueOr(trip.entryType && ENTRY_WORD[trip.entryType], "the entry type"),
    hotel: () => valueOr(trip.hotelStay, "the hotel stay"),
    // Not a gap in the case: "Write it with AI" writes it, or staff type it (amendment 2).
    purpose: () => PURPOSE_MARK,
    // The table itself is drawn below; a {travellers} inside a sentence is refused when the wording is saved.
    travellers: () => "",
  };
  // Wordings are checked when saved, so every blank is known; an unknown one would stay as written.
  const fill = (text: string) =>
    normaliseLetterPart(text.replace(/\{([^{}]*)\}/g, (whole, blank: string) => (Object.hasOwn(blanks, blank) ? blanks[blank as LetterBlank]() : whole)));

  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const at = lines.findIndex((line) => TRAVELLERS_LINE.test(line));
  if (at < 0) return { letter: { top: fill(body), table: null, bottom: "" }, missing: [...missing] };

  const top = fill(lines.slice(0, at).join("\n"));
  const rows = facts.travellers.map((t) => [
    nameOf(t),
    t.relation ?? "",
    valueOr(t.dateOfBirth && dateLabel(t.dateOfBirth), `${whoIs(t)}'s date of birth`),
    valueOr(t.passportNumber, `${whoIs(t)}'s passport number`),
  ]);
  const bottom = fill(lines.slice(at + 1).join("\n"));
  return { letter: { top, table: { columns: [...TRAVELLER_COLUMNS], rows }, bottom }, missing: [...missing] };
}
