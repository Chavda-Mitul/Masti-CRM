import { z } from "zod";
import { ClientKind, type ScanFileType, type SizeUnit } from "../../../generated/prisma/enums";
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

/** The document vault's files (docs/decisions/0016-client-documents.md): a scanner's PDF or a phone photo, by extension. */
export const SCAN_TYPES = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" } as const;
export type ScanType = keyof typeof SCAN_TYPES;
export const isScanType = (contentType: string): contentType is ScanType => Object.hasOwn(SCAN_TYPES, contentType);

/** A scan's type as a paper's upload rules name it. */
export const FILE_TYPE_OF = { "application/pdf": "PDF", "image/jpeg": "JPG", "image/png": "PNG" } as const satisfies Record<ScanType, ScanFileType>;

/**
 * A paper's upload rules (docs/decisions/0016-client-documents.md Amendment 1, change request 16), as the document
 * master keeps them. Null: no minimum, the shared largest scan (clients.documents.maxMb), no photo shape, no smallest or
 * largest photo.
 */
export interface ScanRules {
  fileTypes: ScanFileType[];
  /** In sizeUnit. */
  minSize: number | null;
  maxSize: number | null;
  sizeUnit: SizeUnit;
  photoWidthMm: number | null;
  photoHeightMm: number | null;
  minWidthPx: number | null;
  minHeightPx: number | null;
  maxWidthPx: number | null;
  maxHeightPx: number | null;
}

/** How far a photo's shape may be from its paper's: a scan is never cut exactly. Fixed (project lead, 23 Oct 2026). */
export const SHAPE_MARGIN = 0.03;

/** Bytes in a KB and an MB, as Windows counts them (src/lib/pdf.ts's MB too: this file imports no lib code). */
export const BYTES_PER = { KB: 1024, MB: 1024 * 1024 } as const satisfies Record<SizeUnit, number>;

/** The largest scan a paper takes: its own max in its unit, else the shared one (clients.documents.maxMb) in MB. */
export function largestScan(rules: ScanRules, sharedMaxMb: number): { size: number; unit: SizeUnit } {
  return rules.maxSize !== null ? { size: rules.maxSize, unit: rules.sizeUnit } : { size: sharedMaxMb, unit: "MB" };
}

// The rules' messages. Frontend/src/pages/clients/scanFiles.ts repeats fileTypesText and scanFileProblem word for word,
// and Backend/tests/frontendRules.test.ts compares them. `what` names the paper, e.g. "Photos" in quotes.

/** "a PDF", "a JPG or PNG", "a PDF, JPG or PNG". */
export function fileTypesText(types: readonly ScanFileType[]) {
  return `a ${types.length > 1 ? `${types.slice(0, -1).join(", ")} or ${types.at(-1)}` : types[0]}`;
}

/**
 * A size in whole KB or in MB to 2 decimals: up for a file too big, down for one too small, so it never reads as the
 * limit itself.
 */
function sizeText(bytes: number, unit: SizeUnit, round: "up" | "down") {
  const steps = unit === "KB" ? 1 : 100;
  const n = (round === "up" ? Math.ceil : Math.floor)((bytes / BYTES_PER[unit]) * steps);
  return n === 0 ? `under ${1 / steps} ${unit}` : `${n / steps} ${unit}`;
}

/** Why the paper doesn't take a file of this type, or null. */
export function fileTypeProblem(what: string, rules: ScanRules, type: ScanFileType) {
  return rules.fileTypes.includes(type) ? null : `${what} must be ${fileTypesText(rules.fileTypes)}. This file is ${fileTypesText([type])}.`;
}

/** Why a file of this type and size can't be the paper's scan, or null. The largest is the paper's own, else the shared one. */
export function scanFileProblem(what: string, rules: ScanRules, sharedMaxMb: number, file: { type: ScanFileType; sizeBytes: number }) {
  const wrongType = fileTypeProblem(what, rules, file.type);
  if (wrongType) return wrongType;
  const max = largestScan(rules, sharedMaxMb);
  if (file.sizeBytes > max.size * BYTES_PER[max.unit]) {
    return `${what} can be at most ${max.size} ${max.unit}. This file is ${sizeText(file.sizeBytes, max.unit, "up")}: scan it at a lower resolution.`;
  }
  const unit = rules.sizeUnit;
  if (rules.minSize !== null && file.sizeBytes < rules.minSize * BYTES_PER[unit]) {
    return `${what} must be at least ${rules.minSize} ${unit}. This file is ${sizeText(file.sizeBytes, unit, "down")}: scan it at a higher resolution.`;
  }
  return null;
}

/**
 * Why a photo this many pixels wide and high doesn't have its paper's shape (width ÷ height, within SHAPE_MARGIN), or
 * null. The server's only: it reads the pixels.
 */
export function photoShapeProblem(what: string, rules: ScanRules, pixels: { width: number; height: number }) {
  if (rules.photoWidthMm === null || rules.photoHeightMm === null) return null;
  const wanted = rules.photoWidthMm / rules.photoHeightMm;
  if (Math.abs(pixels.width / pixels.height / wanted - 1) <= SHAPE_MARGIN) return null;
  return (
    `${what} must have the shape of ${rules.photoWidthMm} × ${rules.photoHeightMm} mm. This photo is ` +
    `${pixels.width} × ${pixels.height} pixels: crop it to that shape and upload it again.`
  );
}

/**
 * Why a photo this many pixels wide and high is smaller or bigger than its paper allows (exactly that size when the
 * smallest and the largest are the same), or null. The server's only: it reads the pixels.
 */
export function photoPixelsProblem(what: string, rules: ScanRules, pixels: { width: number; height: number }) {
  const { minWidthPx, minHeightPx, maxWidthPx, maxHeightPx } = rules;
  const hasMin = minWidthPx !== null && minHeightPx !== null;
  const hasMax = maxWidthPx !== null && maxHeightPx !== null;
  const photo = `This photo is ${pixels.width} × ${pixels.height} pixels`;
  if (hasMin && hasMax && minWidthPx === maxWidthPx && minHeightPx === maxHeightPx) {
    if (pixels.width === minWidthPx && pixels.height === minHeightPx) return null;
    return `${what} must be exactly ${minWidthPx} × ${minHeightPx} pixels. ${photo}: make it that size and upload it again.`;
  }
  if (hasMin && (pixels.width < minWidthPx || pixels.height < minHeightPx)) {
    return `${what} must be at least ${minWidthPx} × ${minHeightPx} pixels. ${photo}: scan it at a higher resolution.`;
  }
  if (hasMax && (pixels.width > maxWidthPx || pixels.height > maxHeightPx)) {
    return `${what} can be at most ${maxWidthPx} × ${maxHeightPx} pixels. ${photo}: scan it at a lower resolution.`;
  }
  return null;
}

/**
 * Which paper a scan is, and whose. Sent as the upload's query, since the body is the file itself. No member means the
 * client's own paper.
 */
export const addClientDocumentQuerySchema = z.object({
  documentId: z.coerce.number().int().positive(),
  memberId: z.uuid().optional(),
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

/** "clients.documents": the largest scan the document vault takes. */
export const clientDocumentsSettingSchema = z.object({
  maxMb: z.number().int().min(1).max(200),
});

export const updateClientSettingsSchema = z.object({
  invoiceReadiness: invoiceReadinessSchema.optional(),
  expiryWarnings: expiryWarningsSchema.optional(),
  documents: clientDocumentsSettingSchema.optional(),
});

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type ChangeMobileInput = z.infer<typeof changeMobileSchema>;
export type AddPhoneInput = z.infer<typeof addPhoneSchema>;
export type CreateMemberInput = z.infer<typeof createMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type AddNoteInput = z.infer<typeof addNoteSchema>;
export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;
export type AddClientDocumentQuery = z.infer<typeof addClientDocumentQuerySchema>;
export type ReadinessField = (typeof READINESS_FIELDS)[number];
export type InvoiceReadiness = z.infer<typeof invoiceReadinessSchema>;
export type ExpiryWarnings = z.infer<typeof expiryWarningsSchema>;
export type ClientDocumentsSetting = z.infer<typeof clientDocumentsSettingSchema>;
export type UpdateClientSettingsInput = z.infer<typeof updateClientSettingsSchema>;
