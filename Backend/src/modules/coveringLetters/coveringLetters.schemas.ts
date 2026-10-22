import { z } from "zod";
import { CoveringLetterParty } from "../../../generated/prisma/enums";
import { listQuerySchema } from "../visaMasters/visaMasters.schemas";

// Only zod, the generated enums and other *.schemas.ts files are imported here, so these schemas can be shared with the
// frontend. Frontend/src/pages/settings/masters/schemas.ts repeats the blanks, the limits and wordingProblem so a form
// can show a mistake before saving; tests/frontendRules.test.ts fails if the two drift apart.
// Dates are checked against today in India in the service, as for follow-ups.

/** The longest wording, a page or two. Also a CHECK in the migration. */
export const MAX_LETTER_CHARS = 6000;
/** The most countries one format can be for. */
export const MAX_LETTER_COUNTRIES = 50;

/**
 * The {blanks} a wording may use, filled in from the case when the letter is made (docs/decisions/0019-covering-letters.md
 * Decision 4). {travellers} prints the table of travellers, so it sits on a line of its own. {purpose} is the paragraph
 * on why they travel, which the AI writes with the whole letter, or staff type (amendments 2 and 4): a paragraph too,
 * on a line of its own.
 */
export const LETTER_BLANKS = [
  "date",
  "clientName",
  "clientAddress",
  "applicant",
  "passportNo",
  "travellerNames",
  "travellerCount",
  "travellers",
  "country",
  "visaType",
  "departOn",
  "returnOn",
  "days",
  "entry",
  "hotel",
  "purpose",
] as const;

export type LetterBlank = (typeof LETTER_BLANKS)[number];

const BLANK = /\{([^{}]*)\}/g;

/** Windows line breaks become plain ones and the ends are trimmed, so a wording is stored and measured one way. */
export function normaliseWording(body: string): string {
  return body.replace(/\r\n?/g, "\n").trim();
}

/** What's wrong with a wording's blanks, or null when they're all right. */
export function wordingProblem(body: string): string | null {
  const text = body.replace(/\r\n?/g, "\n");
  for (const [, blank] of text.matchAll(BLANK)) {
    if (!(LETTER_BLANKS as readonly string[]).includes(blank!)) return `{${blank}} isn't one of the blanks. Pick blanks from the list.`;
  }
  if (/[{}]/.test(text.replace(BLANK, ""))) return "A { or } is left over. Blanks are written like {applicant}.";
  const travellers = text.match(/\{travellers\}/g)?.length ?? 0;
  if (travellers > 1) return "Use {travellers} only once: it prints the table of travellers.";
  if (travellers === 1 && !/^[ \t]*\{travellers\}[ \t]*$/m.test(text)) return "Put {travellers} on a line of its own: it prints as a table.";
  const purpose = text.match(/\{purpose\}/g)?.length ?? 0;
  if (purpose > 1) return "Use {purpose} only once: the AI or staff write why they travel there.";
  if (purpose === 1 && !/^[ \t]*\{purpose\}[ \t]*$/m.test(text)) return "Put {purpose} on a line of its own: the AI or staff write why they travel there.";
  return null;
}

const id = z.number().int().positive();
const sortOrder = z.number().int().min(0).max(9999);
const name = z.string("Give the letter a name.").trim().min(1, "Give the letter a name.").max(80, "Keep it under 80 characters.");
const party = z.enum(CoveringLetterParty, "Pick who travels.");

const countryIds = z
  .array(id)
  .min(1, "Pick at least one country.")
  .max(MAX_LETTER_COUNTRIES, `Pick at most ${MAX_LETTER_COUNTRIES} countries.`)
  .refine((ids) => new Set(ids).size === ids.length, "Each country only once.");

/** The letter's text, with its blanks checked. */
const wording = z
  .string("Write the letter.")
  .transform(normaliseWording)
  .pipe(z.string().min(1, "Write the letter.").max(MAX_LETTER_CHARS, `Keep the letter under ${MAX_LETTER_CHARS} characters.`))
  .superRefine((body, ctx) => {
    const problem = wordingProblem(body);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });

/** "Use from": a day in India, today or later (checked in the service). */
const useFrom = z.iso.date("Pick the day it's used from.");

/** The format's updatedAt the screen read. A mismatch means someone else saved in between. */
const updatedAt = z.iso.datetime("Reload and try again.");

export const coveringLetterListQuerySchema = listQuerySchema;

/** A new format comes with its first wording. */
export const createCoveringLetterSchema = z.object({
  name,
  visaTypeId: id,
  party,
  countryIds,
  sortOrder: sortOrder.default(0),
  body: wording,
  effectiveFrom: useFrom,
});

/** Its details change at once; only the wording is dated. */
export const updateCoveringLetterSchema = z.object({
  name: name.optional(),
  visaTypeId: id.optional(),
  party: party.optional(),
  countryIds: countryIds.optional(),
  sortOrder: sortOrder.optional(),
  isActive: z.boolean().optional(),
  updatedAt,
});

export const addWordingSchema = z.object({
  body: wording,
  effectiveFrom: useFrom,
  /** A wording whose day hasn't come yet, which this one replaces ("Change" on it). */
  replacesId: id.optional(),
  updatedAt,
});

export const removeWordingSchema = z.object({ updatedAt });

// ---------------------------------------------------------------------------------------------------------------------
// A case's letter as staff edit it and make it (0019 amendments 1 and 3): one text, not a wording plus values. Its tables
// are lines with | between the columns, drawn by Frontend/src/lib/letter.ts, which repeats the marks and the limit;
// tests/frontendRules.test.ts keeps the two the same.
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A mark the draft puts where the case lacks a value: ⟦the hotel stay⟧. Staff type over it, and "Make the letter" waits
 * while any ⟦ or ⟧ is left. Nothing else in the CRM writes these two characters, unlike square brackets, which a hotel
 * or an address may hold.
 */
export const MARK_OPEN = "⟦";
export const MARK_CLOSE = "⟧";

/**
 * The longest letter a case keeps (amendment 3). The longest draft, 60 travellers with 150-character names and nothing
 * else known, is about 33,000 characters; a real letter is 3,000–9,000. Also a CHECK in the migration.
 */
export const MAX_CASE_LETTER_CHARS = 60000;

/** "the hotel stay" → "⟦the hotel stay⟧". */
export function mark(what: string): string {
  return `${MARK_OPEN}${what}${MARK_CLOSE}`;
}

/**
 * Where {purpose} is in a draft (amendments 2 and 4): the paragraph on why they travel, which the AI writes with the
 * whole letter, or staff type. A mark like any other, so the letter isn't made without it; not a gap in the case, so
 * it isn't in the draft's `missing`.
 */
export const PURPOSE_MARK = mark("why they travel");

/**
 * A value the CRM writes into a letter, each | made a /. Two lines that hold a | are a table (amendment 3), so a hotel
 * or an address with one would split a cell or start a table.
 */
export function noPipes(value: string): string {
  return value.replaceAll("|", "/");
}

/** The marks still in a letter, in plain words and in order, each once. A ⟦ or ⟧ left on its own counts too. */
export function marksIn(letter: string): string[] {
  const found = new Set<string>();
  for (const [, words] of letter.matchAll(/⟦([^⟦⟧\n]*)⟧|[⟦⟧]/g)) found.add(words?.trim() || "a ⟦ or ⟧ left over");
  return [...found];
}

/** Windows line breaks become plain ones, and blank lines at the ends go. The draft and "Make the letter" both use it. */
export function normaliseLetter(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/^\s*\n/, "").trimEnd();
}

/** The letter "Make the letter" sends: its text as staff left it. */
export const letterTextSchema = z
  .string("Write the letter.")
  .transform(normaliseLetter)
  .pipe(
    z
      .string()
      .min(1, "Write the letter.")
      .max(MAX_CASE_LETTER_CHARS, `This letter is too long: keep it under ${MAX_CASE_LETTER_CHARS.toLocaleString("en-IN")} characters.`),
  );

export type CoveringLetterListQuery = z.infer<typeof coveringLetterListQuerySchema>;
export type CreateCoveringLetterInput = z.infer<typeof createCoveringLetterSchema>;
export type UpdateCoveringLetterInput = z.infer<typeof updateCoveringLetterSchema>;
export type AddWordingInput = z.infer<typeof addWordingSchema>;
export type RemoveWordingInput = z.infer<typeof removeWordingSchema>;
