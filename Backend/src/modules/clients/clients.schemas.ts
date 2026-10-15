import { z } from "zod";
import { ClientKind } from "../../../generated/prisma/enums";
import { gstin, pan, PERSON_NAME_MESSAGE, PERSON_NAME_PATTERN, stateCode, upperNoSpaces } from "../../lib/shared.schemas";

// Only zod, the generated enums and the shared fields (src/lib/shared.schemas.ts) are imported here, so these schemas
// can later be shared with the frontend. Mobile numbers and emails are normalised in the service (like users),
// everything else here.

export const PASSPORT_PATTERN = /^[A-Z0-9]{6,12}$/;

/** A company's name needs a letter; digits and symbols are fine ("3M India", "Shah & Sons"). */
export const COMPANY_NAME_PATTERN = /\p{L}/u;
export const COMPANY_NAME_MESSAGE = "The company name needs at least one letter.";

/** "" and null both clear a field; a missing key means "not sent". */
const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const clearable = <T extends z.ZodType>(schema: T) => z.preprocess(blankToNull, schema.nullable()).optional();

const text = (max: number) => z.string().trim().max(max);
const personName = (max: number) => text(max).regex(PERSON_NAME_PATTERN, PERSON_NAME_MESSAGE);
const mobile = z.string().trim().max(30);
const isoDate = z.iso.date("Use a date like 2026-10-08.");
const confirmDuplicates = z.boolean().default(false);
/** The updatedAt the client last read. A mismatch means someone else saved in between. */
const updatedAt = z.iso.datetime("Reload and try again.");

const passportNumber = upperNoSpaces.pipe(
  z.string().regex(PASSPORT_PATTERN, "Enter the passport number as printed (6–12 letters and digits)."),
);
const pincode = z.string().trim().regex(/^[1-9][0-9]{5}$/, "Enter a 6-digit PIN code.");
const lookupId = z.number().int().positive();

/** Staff always give a name (decided 9 Oct 2026, amending 0004). "" and null are refused, never stored as a clear. */
const NAME_MESSAGE = "Enter the client's name.";
const requiredName = z.preprocess(blankToNull, z.string({ error: NAME_MESSAGE }).trim().min(1, NAME_MESSAGE).max(150));

const clientFields = {
  kind: z.enum(ClientKind).optional(),
  name: requiredName.optional(),
  contactPerson: clearable(personName(150)),
  email: clearable(text(200)),
  addressLine: clearable(text(300)),
  area: clearable(text(100)),
  city: clearable(text(100)),
  stateCode: clearable(stateCode),
  pincode: clearable(pincode),
  pan: clearable(pan),
  gstin: clearable(gstin),
  // Accounts fields: only Accounts (or the Head) may set or change them.
  accountingCode: clearable(text(50)),
  billingCycleId: lookupId.optional(),
  paymentHabitId: clearable(lookupId),
  clientSince: isoDate.optional(),
  confirmDuplicates,
};

export const createClientSchema = z.object({
  mobile: mobile.min(1, "Enter the mobile number."),
  ...clientFields,
  name: requiredName,
});

export const updateClientSchema = z.object({ ...clientFields, updatedAt });

export const changeMobileSchema = z.object({
  mobile: mobile.min(1, "Enter the new mobile number."),
  /** Keep the old main number as an extra number. */
  keepOldAsSecondary: z.boolean().default(true),
  confirmDuplicates,
});

export const addPhoneSchema = z.object({
  mobile: mobile.min(1, "Enter the mobile number."),
  label: clearable(text(50)),
  confirmDuplicates,
});

export const createMemberSchema = z.object({
  name: text(150).min(1, "Enter the name as printed in the passport.").regex(PERSON_NAME_PATTERN, PERSON_NAME_MESSAGE),
  relationId: lookupId,
  dateOfBirth: clearable(isoDate),
  mobile: clearable(mobile),
  passportNumber: clearable(passportNumber),
  passportExpiry: clearable(isoDate),
  confirmDuplicates,
});

export const updateMemberSchema = z.object({
  name: text(150).min(1, "Enter the name as printed in the passport.").regex(PERSON_NAME_PATTERN, PERSON_NAME_MESSAGE).optional(),
  relationId: lookupId.optional(),
  dateOfBirth: clearable(isoDate),
  mobile: clearable(mobile),
  passportNumber: clearable(passportNumber),
  passportExpiry: clearable(isoDate),
  updatedAt,
  confirmDuplicates,
});

export const addNoteSchema = z.object({
  body: text(2000).min(1, "Write the note first."),
});

export const listClientsQuerySchema = z.object({
  /** Name, mobile (main or extra), passport number, PAN, GSTIN or accounting code. */
  q: z.string().trim().max(100).optional(),
  kind: z.enum(ClientKind).optional(),
  /** true: only clients missing a field needed before invoicing; false: only complete ones. */
  incomplete: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const lookupQuerySchema = z.object({
  mobile: z.string().trim().min(1, "Enter a mobile number.").max(30),
});

// ---------------------------------------------------------------------------
// Settings (rows in the Setting table; see clients.settings.ts)
// ---------------------------------------------------------------------------

/** Client fields the invoice-readiness setting may require. */
export const READINESS_FIELDS = [
  "name",
  "contactPerson",
  "email",
  "addressLine",
  "area",
  "city",
  "stateCode",
  "pincode",
  "pan",
  "gstin",
  "accountingCode",
] as const;

const fieldList = z
  .array(z.enum(READINESS_FIELDS))
  .refine((fields) => new Set(fields).size === fields.length, "List each field once.");

/** "clients.invoiceReadiness": what must be filled in, per kind of client, before an invoice can be raised. */
export const invoiceReadinessSchema = z.object({
  INDIVIDUAL: fieldList.refine((fields) => !fields.includes("contactPerson"), "Only companies have a contact person."),
  CORPORATE: fieldList,
});

/** "clients.expiryWarnings": when a passport shows "renew soon". */
export const expiryWarningsSchema = z.object({
  passportRenewSoonMonths: z.number().int().min(0).max(60),
});

export const updateClientSettingsSchema = z.object({
  invoiceReadiness: invoiceReadinessSchema.optional(),
  expiryWarnings: expiryWarningsSchema.optional(),
});

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type ChangeMobileInput = z.infer<typeof changeMobileSchema>;
export type AddPhoneInput = z.infer<typeof addPhoneSchema>;
export type CreateMemberInput = z.infer<typeof createMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type AddNoteInput = z.infer<typeof addNoteSchema>;
export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;
export type ReadinessField = (typeof READINESS_FIELDS)[number];
export type InvoiceReadiness = z.infer<typeof invoiceReadinessSchema>;
export type ExpiryWarnings = z.infer<typeof expiryWarningsSchema>;
export type UpdateClientSettingsInput = z.infer<typeof updateClientSettingsSchema>;
