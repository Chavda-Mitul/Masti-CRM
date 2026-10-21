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
 * Decision 4). {travellers} prints the table of travellers, so it sits on a line of its own.
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
// A case's letter as staff edit it and make it (0019 amendment 1, 21 Oct 2026): its text, not a wording plus values.
// Frontend/src/lib/letter.ts repeats the marks and the limits; tests/frontendRules.test.ts keeps the two the same.
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A mark the draft puts where the case lacks a value: ⟦the hotel stay⟧. Staff type over it, and "Make the letter" waits
 * while any ⟦ or ⟧ is left. Nothing else in the CRM writes these two characters, unlike square brackets, which a hotel
 * or an address may hold.
 */
export const MARK_OPEN = "⟦";
export const MARK_CLOSE = "⟧";

/** The text above or below the table: a page or two. */
export const MAX_LETTER_PART_CHARS = 8000;
export const MAX_LETTER_COLUMNS = 6;
/** A row for every traveller a case can have: MAX_ADULTS + MAX_CHILDREN (visa.schemas.ts, checked by a test). */
export const MAX_LETTER_ROWS = 60;
export const MAX_LETTER_HEADING_CHARS = 60;
/** A cell holds a name, a relation, a date or a passport number: 200 leaves room for the longest name. */
export const MAX_LETTER_CELL_CHARS = 200;

export interface LetterTable {
  columns: string[];
  rows: string[][];
}

/** The letter: the text above the table, the table (where {travellers} was; null when the wording has none), the text below. */
export interface LetterText {
  top: string;
  table: LetterTable | null;
  /** Empty when there's no table: all the text is then on top. */
  bottom: string;
}

/** "the hotel stay" → "⟦the hotel stay⟧". */
export function mark(what: string): string {
  return `${MARK_OPEN}${what}${MARK_CLOSE}`;
}

/** The marks still in a letter, in plain words and in order, each once. A ⟦ or ⟧ left on its own counts too. */
export function marksIn(letter: LetterText): string[] {
  const parts = [letter.top, ...(letter.table ? [...letter.table.columns, ...letter.table.rows.flat()] : []), letter.bottom];
  const found = new Set<string>();
  for (const part of parts) {
    for (const [, words] of part.matchAll(/⟦([^⟦⟧\n]*)⟧|[⟦⟧]/g)) found.add(words?.trim() || "a ⟦ or ⟧ left over");
  }
  return [...found];
}

/** Windows line breaks become plain ones, and blank lines at the ends go. The draft and "Make the letter" both use it. */
export function normaliseLetterPart(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/^\s*\n/, "").trimEnd();
}

/** A heading or a cell sits on one line. */
function oneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

const letterPart = (where: string) =>
  z
    .string(`Send the text ${where} the table.`)
    .transform(normaliseLetterPart)
    .pipe(z.string().max(MAX_LETTER_PART_CHARS, `Keep the text ${where} the table under ${MAX_LETTER_PART_CHARS} characters.`));

/** The letter "Make the letter" sends. The messages say which part is wrong, since they arrive under one field. */
export const letterTextSchema = z
  .object({
    top: letterPart("above"),
    table: z
      .object({
        columns: z.array(z.string().transform(oneLine)),
        rows: z.array(z.array(z.string().transform(oneLine))),
      })
      .nullable(),
    bottom: letterPart("below"),
  })
  .superRefine((letter, ctx) => {
    const problem = (message: string) => ctx.addIssue({ code: "custom", message });
    const { table } = letter;
    if (!table) {
      if (letter.bottom) problem("Without a table, all the text goes above it.");
      if (!letter.top) problem("Write the letter.");
      return;
    }
    const { columns, rows } = table;
    if (!letter.top && !letter.bottom && rows.length === 0) problem("Write the letter.");
    if (columns.length < 1 || columns.length > MAX_LETTER_COLUMNS) problem(`Give the table 1 to ${MAX_LETTER_COLUMNS} columns.`);
    columns.forEach((heading, c) => {
      if (!heading) problem(`Give the table's column ${c + 1} a heading.`);
      else if (heading.length > MAX_LETTER_HEADING_CHARS) problem(`Keep the heading "${heading.slice(0, 20)}…" under ${MAX_LETTER_HEADING_CHARS} characters.`);
    });
    if (rows.length > MAX_LETTER_ROWS) problem(`Keep the table to ${MAX_LETTER_ROWS} rows.`);
    rows.forEach((cells, r) => {
      if (cells.length !== columns.length) problem(`The table's row ${r + 1} needs one cell for each column.`);
      cells.forEach((cell, c) => {
        if (cell.length > MAX_LETTER_CELL_CHARS) {
          problem(`The table's row ${r + 1}, ${columns[c] || `column ${c + 1}`}, is over ${MAX_LETTER_CELL_CHARS} characters.`);
        }
      });
    });
  });

export type CoveringLetterListQuery = z.infer<typeof coveringLetterListQuerySchema>;
export type CreateCoveringLetterInput = z.infer<typeof createCoveringLetterSchema>;
export type UpdateCoveringLetterInput = z.infer<typeof updateCoveringLetterSchema>;
export type AddWordingInput = z.infer<typeof addWordingSchema>;
export type RemoveWordingInput = z.infer<typeof removeWordingSchema>;
