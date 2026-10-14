import { z } from "zod";
import { PERSON_NAME_MESSAGE, PERSON_NAME_PATTERN } from "../clients/clients.schemas";

// Only zod and plain rules are imported here, so these schemas can later be shared with the frontend.
// Mobile numbers and emails are normalised in the service (src/lib/contact.ts), as for clients and users.

/** The most countries one vendor can cover. Mirrored in the frontend (tests/frontendRules.test.ts). */
export const MAX_VENDOR_COUNTRIES = 50;

/** "" and null both clear a field; a missing key means "not sent". */
const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const clearable = <T extends z.ZodType>(schema: T) => z.preprocess(blankToNull, schema.nullable()).optional();

const text = (max: number) => z.string().trim().min(1, "This can't be empty.").max(max, `Keep it under ${max} characters.`);
const personName = (max: number) => text(max).regex(PERSON_NAME_PATTERN, PERSON_NAME_MESSAGE);

/**
 * The dispatch email goes here (docs/decisions/0008-visa-docket-dispatch.md Decision 8), so every vendor has one: required
 * when adding, and it can be changed but not cleared (decided 14 Oct 2026, project lead). Its format is checked in the
 * service; the database requires it too.
 */
const vendorEmail = z
  .string("Enter the vendor's email: the dispatch email goes to it.")
  .trim()
  .min(1, "Enter the vendor's email: the dispatch email goes to it.")
  .max(200, "Keep it under 200 characters.");

const countryIds = z
  .array(z.number().int().positive())
  .min(1, "Pick at least one country.")
  .max(MAX_VENDOR_COUNTRIES, `Pick at most ${MAX_VENDOR_COUNTRIES} countries.`)
  .refine((ids) => new Set(ids).size === ids.length, "Each country only once.");

/** ?active=true|false, and ?countryId= for the case's vendor picker (only vendors covering that country). */
export const vendorListQuerySchema = z.object({
  active: z.enum(["true", "false"]).optional().transform((v) => (v === undefined ? undefined : v === "true")),
  countryId: z.coerce.number().int().positive().optional(),
});

export const createVendorSchema = z.object({
  name: text(120),
  city: text(80),
  countryIds,
  contactName: clearable(personName(120)),
  mobile: clearable(z.string().trim().max(30)),
  email: vendorEmail,
  isActive: z.boolean().default(true),
});

export const updateVendorSchema = z.object({
  name: text(120).optional(),
  city: text(80).optional(),
  countryIds: countryIds.optional(),
  contactName: clearable(personName(120)),
  mobile: clearable(z.string().trim().max(30)),
  email: vendorEmail.optional(),
  isActive: z.boolean().optional(),
});

export type VendorListQuery = z.infer<typeof vendorListQuerySchema>;
export type CreateVendorInput = z.infer<typeof createVendorSchema>;
export type UpdateVendorInput = z.infer<typeof updateVendorSchema>;
