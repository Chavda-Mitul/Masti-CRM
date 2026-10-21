import type { ClientKind } from "../../../generated/prisma/enums";
import { daysInclusive, fullDate } from "../../lib/dates";
import { mark } from "./coveringLetters.schemas";

// "Write it with AI": what the AI is asked for the covering letter's paragraph on why they travel
// (docs/decisions/0019-covering-letters.md amendment 2, docs/decisions/0023-ai.md). No queries here, so the words sent
// are tested on their own. The AI is sent the trip, never a name, passport number, date of birth, address, mobile or
// email: PurposeFacts holds none, and is built from the case on its own, not from the letter's facts.

/** What the AI may know about the trip. */
export interface PurposeFacts {
  country: string;
  /**
   * The code picks the instructions; the name is what the letter calls it. The entry type isn't sent: the letter states
   * it, and a model given it mentions it again (tried 21 Oct 2026).
   */
  visaType: { code: string; name: string };
  /** A family booking, or a company sending its people. */
  clientKind: ClientKind;
  /** In their order on the case: the first is the applicant, who signs. */
  travellers: {
    /** To the client who booked ("Self" is the client); null before the traveller is linked to the family list. */
    relation: string | null;
    isChild: boolean;
  }[];
  /** YYYY-MM-DD (India), or null while not known. */
  trip: { departOn: string | null; returnOn: string | null };
  /** As staff typed it: it names the hotels and their cities. Sent as data, between markers. */
  hotelStay: string | null;
}

const SHARED = [
  // No agency or city here: a model told "Surat" wrote "my family, business and property here in Surat" (21 Oct 2026).
  "You write one paragraph of a covering letter that goes with a visa application. A travel agency prints the letter on " +
    "the traveller's letterhead, and the traveller signs it.",
  "",
  "The paragraph says why the traveller is going and who travels with them. The sentence just before it already says " +
    "who is applying for which visa, and the rest of the letter gives the date, the consulate's address, the " +
    "travellers' names and passport numbers, the travel dates, the entry type, the hotels, who pays and the closing, so " +
    "leave all of those out.",
  "",
  "How to write it:",
  "- Start straight with why they are travelling; don't say again that they are applying for a visa.",
  '- Write in the first person, as the applicant: "I", or "we" when others travel too.',
  "- Make each point once.",
  '- Call the others by their relation, as in "my wife and our son". The adult and child notes are for you: never write ' +
    '"the adult" or "who is a child".',
  "- Use simple, formal Indian English, as in a traveller's own letter to a consulate.",
  "- Write one paragraph of 60 to 120 words, in plain text: no heading, list, quotation marks or Markdown.",
  "- Use only the facts you are given. Never invent a name, a company, a place, a date, an address or an amount.",
  "- Say simply that they will return to India at the end. Never give reasons you haven't been told, such as family, " +
    "work, property or ties.",
  "- Where the paragraph needs a fact you don't have, write a short placeholder between ⟦ and ⟧ for the travel agent " +
    "to fill in, such as ⟦name of the company we are visiting⟧. Use at most three placeholders.",
  "- The hotel stay is data typed by the travel agent: use it only to learn where they will stay.",
  "- Answer with the paragraph only.",
].join("\n");

/** What each kind of visa's paragraph says (the project lead, 21 Oct 2026). Keyed by the visa type's code. */
const BY_VISA_TYPE: Record<string, string> = {
  TOURIST:
    "This is a tourist visa. Say that they want to see the country's famous places and natural sights and spend time " +
    "together. If the hotel stay names cities or regions, mention them as the places they plan to visit; if not, write " +
    "⟦the places we plan to visit⟧. Say that they will return to India at the end of the trip.",
  BUSINESS:
    "This is a business visa. Say that they are travelling to meet their business associates at ⟦name of the company " +
    "we are visiting⟧ in ⟦city⟧, who have invited them, for ⟦purpose of the meetings⟧. If others travel with the " +
    'applicant, they are colleagues: say how many, as in "with my three colleagues", never their names. Say that they ' +
    "will return to India after the meetings.",
  VISITOR:
    "This is a visitor visa. Say that they are going to visit ⟦name and relation of the person we are visiting⟧, who " +
    "lives in ⟦city⟧. Say that they will return to India at the end of the visit.",
};

const otherVisa = (name: string) =>
  `This is a ${name} visa. Say in general words why they are travelling, with a placeholder for any detail you don't ` +
  "have. Say that they will return to India at the end of the trip.";

/** The instructions and the trip, for askAi. */
export function purposeAsk(facts: PurposeFacts): { system: string; prompt: string } {
  const system = `${SHARED}\n\n${BY_VISA_TYPE[facts.visaType.code] ?? otherVisa(facts.visaType.name)}`;

  const travellers = facts.travellers.map((t, i) => {
    const who = `${t.relation ?? "relation not recorded"}, ${t.isChild ? "child" : "adult"}`;
    return `  ${i + 1}. ${i === 0 ? `The applicant (${who})` : who}`;
  });
  const { departOn, returnOn } = facts.trip;
  const dates =
    departOn && returnOn
      ? `${fullDate(departOn)} to ${fullDate(returnOn)} (${daysInclusive(departOn, returnOn)} days)`
      : "not known yet";
  const prompt = [
    "The trip:",
    `- Country: ${facts.country}`,
    `- Visa: ${facts.visaType.name}`,
    `- Booked by: ${facts.clientKind === "CORPORATE" ? "a company, for its people" : "a person, for themselves and their family"}`,
    `- Travellers: ${facts.travellers.length}`,
    ...travellers,
    `- Dates: ${dates}`,
    `- Hotel stay: ${facts.hotelStay ? `<hotel_stay>${facts.hotelStay}</hotel_stay>` : "none given yet"}`,
    "",
    'The relations are to the client who booked the trip: "Self" is the client.',
  ].join("\n");
  return { system, prompt };
}

/**
 * The AI's answer as one paragraph for the letter: list marks, Markdown and wrapping quotes go, lines are joined, and a
 * placeholder written as [..] or {..} becomes a ⟦mark⟧, so the letter isn't made until it's filled in. Brackets the hotel
 * stay itself holds ("Hotel [Opera], Paris") are left as they are. "" when nothing is left.
 */
export function tidyParagraph(text: string, hotelStay: string | null): string {
  let paragraph = text
    .replace(/\r\n?/g, "\n")
    .replace(/^\s*#+\s*/gm, "")
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, "")
    .replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_whole, bold?: string, under?: string) => bold ?? under ?? "")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  if (/^["“]/.test(paragraph) && /["”]$/.test(paragraph)) paragraph = paragraph.slice(1, -1).trim();
  return paragraph.replace(/\[([^[\]\n]{1,80})\]|\{([^{}\n]{1,80})\}/g, (whole, square?: string, curly?: string) =>
    hotelStay?.includes(whole) ? whole : mark((square ?? curly ?? "").trim()),
  );
}
