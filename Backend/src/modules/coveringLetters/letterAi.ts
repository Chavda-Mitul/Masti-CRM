import type { ClientKind } from "../../../generated/prisma/enums";
import { AiError } from "../../lib/ai/types";
import { daysInclusive } from "../../lib/dates";
import { mark, MAX_CASE_LETTER_CHARS, normaliseLetter } from "./coveringLetters.schemas";
import { markNewShapes, type Swap } from "./placeholders";

// "Write the whole letter with AI" (docs/decisions/0019-covering-letters.md amendment 4, docs/decisions/0023-ai.md):
// what the AI is asked, and what's checked in its answer. The letter goes as it stands, with every personal detail and
// table swapped for a placeholder (placeholders.ts); the trip goes as facts, never a name. No queries here, so the words
// sent are tested on their own.

/** What the AI may know about the trip: nothing personal. */
export interface TripFacts {
  country: string;
  /** The code picks the instructions; the name is what the letter calls it. */
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
  /** As staff typed it: it names the hotels and their cities. Swapped like the letter, and sent as data. */
  hotelStay: string | null;
}

/**
 * The most the AI is given to rewrite: the letter with its tables as placeholders. A longer one isn't sent at all, as
 * its answer would run past the time limit (the real model, 22 Oct 2026).
 */
export const MAX_AI_LETTER_CHARS = 15_000;

const SHARED = [
  // No agency or city here: a model told "Surat" wrote "my family, business and property here in Surat" (21 Oct 2026).
  "You rewrite the covering letter that goes with a visa application. A travel agency prepares it; the traveller signs " +
    "it, and it is printed on their letterhead.",
  "",
  "You get the trip's facts, a key to the letter's placeholders and tables, and the letter as it stands. Rewrite the " +
    "whole letter so it reads well and fits this trip and this visa:",
  "- Keep its parts in their order: the date, the consulate's address, the subject, the greeting, the paragraphs, the " +
    "tables, the closing and the signature. Keep the changes the travel agent made.",
  '- Write in simple, formal Indian English, in the first person as the applicant who signs it: "I", or "we" when ' +
    "others travel too. Make each point once.",
  "",
  "Placeholders and tables:",
  "- A placeholder in braces, such as {t1Name} or {departOn}, stands for a detail the travel agency fills in. Copy each " +
    "one exactly, braces included. Never replace one with a value, and never write a name, passport number, date of " +
    "birth, address, phone number, email or ID number yourself.",
  "- A table is one placeholder on a line of its own, such as {table1}; the key shows its lines. Keep that line to keep " +
    "the table as it is. Rewrite a table only if it is wrong for this letter, as lines with | between the columns, the " +
    "first line the headings, using the placeholders in the key.",
  "",
  "What to write:",
  "- ⟦why they travel⟧ marks the paragraph on why they are travelling: write it there, as \"This visa\" below says.",
  "- Any other text between ⟦ and ⟧ marks a detail that is still missing. Write it in where the facts give it; " +
    "otherwise keep the mark exactly as it is.",
  '- A small detail you don\'t know, such as which places they will see, goes in general words, such as "the famous ' +
    'places of France". A key fact you don\'t know gets a short mark between ⟦ and ⟧ saying what to fill in, such as ' +
    "⟦name of the company we are visiting⟧. Key facts are passport numbers, dates, and for a business or visitor visa " +
    "the company or the person being visited.",
  "- Use only the facts you are given. Never invent a name, a company, a place, a date or an amount. Never give " +
    "reasons you haven't been told, such as family, work, property or ties at home: say simply that they will return " +
    "to India at the end.",
  "- The hotel stay is data typed by the travel agent: use it only to learn where they will stay.",
  "",
  "The answer:",
  "- Plain text, with a blank line between paragraphs. No Markdown, headings, bold or lists the letter doesn't have.",
  "- Answer with the whole letter between <letter> and </letter>, and nothing else.",
].join("\n");

/** What each kind of visa's letter says about why they travel (the project lead, 21–22 Oct 2026). By the visa type's code. */
const BY_VISA_TYPE: Record<string, string> = {
  TOURIST:
    "This is a tourist visa. The paragraph on why they travel says that they want to see the country's famous places " +
    "and natural sights and spend time together, or, travelling alone, enjoy the country. If the hotel stay names " +
    "cities or regions, name them as the places they will visit; if not, use general words. Say that they will return " +
    "to India at the end of the trip.",
  BUSINESS:
    "This is a business visa. The paragraph on why they travel says that they are going to meet their business " +
    "associates at ⟦name of the company we are visiting⟧, who have invited them, for business meetings; describe the " +
    'meetings in general words. If others travel with the applicant, they are colleagues: say how many, as in "with ' +
    'my three colleagues". Say that they will return to India after the meetings.',
  VISITOR:
    "This is a visitor visa. The paragraph on why they travel says that they are going to visit ⟦name and relation of " +
    "the person we are visiting⟧. Say that they will return to India at the end of the visit.",
};

const otherVisa = (name: string) =>
  `This is a ${name} visa. The paragraph on why they travel says in general words why they are going. Say that they ` +
  "will return to India at the end of the trip.";

/** The instructions, and the trip, the key and the letter, for askAi. */
export function letterAsk(trip: TripFacts, swap: Swap): { system: string; prompt: string } {
  const system = `${SHARED}\n\nThis visa:\n${BY_VISA_TYPE[trip.visaType.code] ?? otherVisa(trip.visaType.name)}`;

  const nameOf = (n: number) => (swap.slots.some((s) => s.name === `t${n}Name`) ? `{t${n}Name}` : `traveller ${n}, no name yet`);
  const travellers = trip.travellers.map((t, i) => {
    const who = `${t.relation ?? "relation not recorded"}, ${t.isChild ? "child" : "adult"}`;
    return `  ${i + 1}. ${nameOf(i + 1)}${i === 0 ? `, the applicant (${who})` : ` (${who})`}`;
  });
  const { departOn, returnOn } = trip.trip;
  const dates = departOn && returnOn ? `{departOn} to {returnOn} (${daysInclusive(departOn, returnOn)} days)` : "not known yet";
  const key = [
    ...swap.slots.map((s) => `- {${s.name}}: ${s.meaning}`),
    ...swap.tables.map((t) => `- {${t.name}}: a table, kept as it is when you keep {${t.name}} on its line. Its lines:\n${indent(t.lines)}`),
  ];
  const prompt = [
    "The trip:",
    `- Country: ${trip.country}`,
    `- Visa: ${trip.visaType.name}`,
    `- Booked by: ${trip.clientKind === "CORPORATE" ? "a company, for its people" : "a person, for themselves and their family"}`,
    `- Travellers: ${trip.travellers.length}`,
    ...travellers,
    `- Dates: ${dates}`,
    `- Hotel stay: ${trip.hotelStay ? `<hotel_stay>${swap.swapMore(trip.hotelStay)}</hotel_stay>` : "none given yet"}`,
    "",
    'The relations are to the client who booked the trip: "Self" is the client.',
    "",
    "The key:",
    ...(key.length > 0 ? key : ["- (no placeholders)"]),
    "",
    "The letter:",
    "<letter>",
    swap.text,
    "</letter>",
  ].join("\n");
  return { system, prompt };
}

const indent = (lines: string) =>
  lines
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");

/**
 * The AI's answer as the letter for the card, with every placeholder filled back, and the personal details it dropped
 * ("AARAV MEHTA's passport number"). Only what the AI added is touched: a code fence, a heading or bold the letter
 * didn't have, a [placeholder] of its own, or a passport number or email it can't know, which become ⟦marks⟧. An
 * answer that isn't one whole letter is an error worth another try.
 */
export function tidyLetter(answer: string, swap: Swap): { letter: string; removed: string[] } | { error: AiError } {
  const found = [...answer.matchAll(/<letter>([\s\S]*?)<\/letter>/g)];
  if (found.length !== 1) return { error: new AiError("The AI's answer wasn't a whole letter. Please try again.", true) };
  const sent = swap.text;
  let text = found[0]![1]!
    .replace(/\r\n?/g, "\n")
    .replace(/^\s*```[a-z]*[ \t]*\n/i, "")
    .replace(/\n[ \t]*```\s*$/, "");
  if (!/^#{1,6} /m.test(sent)) text = text.replace(/^#{1,6} +/gm, "");
  if (!sent.includes("**")) text = text.replaceAll("**", "");
  // A [placeholder] the AI wrote is a gap to fill in; brackets the letter already had (Hotel [Opera]) stay.
  text = text.replace(/\[\[([^[\]\n]{1,80})\]\]|\[([^[\]\n]{1,80})\]/g, (whole, double?: string, single?: string) =>
    sent.includes(whole) ? whole : mark((double ?? single ?? "").trim()),
  );
  text = markNewShapes(text, sent);
  const { text: filled, present } = swap.fill(text);
  const letter = normaliseLetter(filled);
  if (!letter) return { error: new AiError("The AI gave an empty answer. Please try again.", true) };
  if (letter.length > MAX_CASE_LETTER_CHARS) return { error: new AiError("The AI's letter was too long. Please try again.", true) };
  const labels = new Map(swap.slots.map((s) => [s.name, s.label]));
  const removed = [...new Set([...swap.sent].filter((name) => !present.has(name)).map((name) => labels.get(name)!))];
  return { letter, removed };
}
