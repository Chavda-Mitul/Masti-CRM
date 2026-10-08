import { z } from "zod";
import { ClientKind } from "../../../generated/prisma/enums";

// Only zod and the generated enums are imported here, so these schemas can later be shared with the frontend.
// Mobile numbers and emails are normalised in the service (like users), everything else here.

/** GST state codes (statutory, not business config). Decides the place of supply on invoices. */
export const GST_STATES = [
  { code: "01", name: "Jammu and Kashmir" },
  { code: "02", name: "Himachal Pradesh" },
  { code: "03", name: "Punjab" },
  { code: "04", name: "Chandigarh" },
  { code: "05", name: "Uttarakhand" },
  { code: "06", name: "Haryana" },
  { code: "07", name: "Delhi" },
  { code: "08", name: "Rajasthan" },
  { code: "09", name: "Uttar Pradesh" },
  { code: "10", name: "Bihar" },
  { code: "11", name: "Sikkim" },
  { code: "12", name: "Arunachal Pradesh" },
  { code: "13", name: "Nagaland" },
  { code: "14", name: "Manipur" },
  { code: "15", name: "Mizoram" },
  { code: "16", name: "Tripura" },
  { code: "17", name: "Meghalaya" },
  { code: "18", name: "Assam" },
  { code: "19", name: "West Bengal" },
  { code: "20", name: "Jharkhand" },
  { code: "21", name: "Odisha" },
  { code: "22", name: "Chhattisgarh" },
  { code: "23", name: "Madhya Pradesh" },
  { code: "24", name: "Gujarat" },
  { code: "26", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "27", name: "Maharashtra" },
  { code: "29", name: "Karnataka" },
  { code: "30", name: "Goa" },
  { code: "31", name: "Lakshadweep" },
  { code: "32", name: "Kerala" },
  { code: "33", name: "Tamil Nadu" },
  { code: "34", name: "Puducherry" },
  { code: "35", name: "Andaman and Nicobar Islands" },
  { code: "36", name: "Telangana" },
  { code: "37", name: "Andhra Pradesh" },
  { code: "38", name: "Ladakh" },
  { code: "97", name: "Other Territory" },
] as const;

const STATE_CODES = new Set<string>(GST_STATES.map((s) => s.code));

export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
/** Regular GSTIN: state code, PAN, entity number, "Z", check character. */
export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PASSPORT_PATTERN = /^[A-Z0-9]{6,12}$/;

const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The 15th character of a GSTIN is a check character over the first 14 (base-36, alternating weights 1 and 2). */
export function gstinChecksumOk(gstin: string): boolean {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(gstin.charAt(i)) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS.charAt((36 - (sum % 36)) % 36) === gstin.charAt(14);
}

/** "" and null both clear a field; a missing key means "not sent". */
const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const clearable = <T extends z.ZodType>(schema: T) => z.preprocess(blankToNull, schema.nullable()).optional();

const text = (max: number) => z.string().trim().max(max);
const mobile = z.string().trim().max(30);
const isoDate = z.iso.date("Use a date like 2026-10-08.");
const confirmDuplicates = z.boolean().default(false);
/** The updatedAt the client last read. A mismatch means someone else saved in between. */
const updatedAt = z.iso.datetime("Reload and try again.");

const upperNoSpaces = z.string().transform((s) => s.replace(/\s+/g, "").toUpperCase());

const pan = upperNoSpaces.pipe(z.string().regex(PAN_PATTERN, "Enter a valid PAN, e.g. ABCDE1234F."));
const gstin = upperNoSpaces.pipe(
  z
    .string()
    .regex(GSTIN_PATTERN, "Enter a valid 15-character GSTIN.")
    .refine(gstinChecksumOk, "This GSTIN's last character doesn't match. Check it for a typo."),
);
const passportNumber = upperNoSpaces.pipe(
  z.string().regex(PASSPORT_PATTERN, "Enter the passport number as printed (6–12 letters and digits)."),
);
const stateCode = z.string().trim().refine((code) => STATE_CODES.has(code), "Pick a state from the list.");
const pincode = z.string().trim().regex(/^[1-9][0-9]{5}$/, "Enter a 6-digit PIN code.");
const lookupId = z.number().int().positive();

const clientFields = {
  kind: z.enum(ClientKind).optional(),
  name: clearable(text(150)),
  contactPerson: clearable(text(150)),
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
  name: text(150).min(1, "Enter the name as printed in the passport."),
  relationId: lookupId,
  dateOfBirth: clearable(isoDate),
  mobile: clearable(mobile),
  passportNumber: clearable(passportNumber),
  passportExpiry: clearable(isoDate),
  confirmDuplicates,
});

export const updateMemberSchema = z.object({
  name: text(150).min(1, "Enter the name as printed in the passport.").optional(),
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
