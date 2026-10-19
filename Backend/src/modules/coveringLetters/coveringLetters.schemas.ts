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

export type CoveringLetterListQuery = z.infer<typeof coveringLetterListQuerySchema>;
export type CreateCoveringLetterInput = z.infer<typeof createCoveringLetterSchema>;
export type UpdateCoveringLetterInput = z.infer<typeof updateCoveringLetterSchema>;
export type AddWordingInput = z.infer<typeof addWordingSchema>;
export type RemoveWordingInput = z.infer<typeof removeWordingSchema>;
