import { z } from "zod";
import { EMAIL_PATTERN, gstin, pan, stateCode, upperNoSpaces } from "../../lib/shared.schemas";

// Only zod and the shared fields (src/lib/shared.schemas.ts, zod only) are imported here, so these schemas can later be
// shared with the frontend.

const line = (max: number) => z.string().trim().min(1, "Can't be blank.").max(max, `${max} characters at most.`);

/** "" and null both clear an optional field; a missing key means "not sent". */
const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const clearable = <T extends z.ZodType>(schema: T) => z.preprocess(blankToNull, schema.nullable()).optional();
/** As stored: an optional field is null until someone fills it in, so a row saved before it existed still reads. */
const stored = <T extends z.ZodType>(schema: T) => schema.nullable().default(null);

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(120, "120 characters at most.")
  .regex(EMAIL_PATTERN, "Enter a valid email address.");

/** "https://www.example.com/" is kept as "www.example.com": the invoice prints the host. */
const website = z
  .string()
  .trim()
  .transform((s) => s.replace(/^https?:\/\//i, "").replace(/\/+$/, ""))
  .pipe(
    z
      .string()
      .max(100, "100 characters at most.")
      .regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i, "Enter a website like www.example.com."),
  );

/** Masti's bank account, printed on every invoice. SWIFT is optional (only needed for payments from abroad). */
export const bankSchema = z.object({
  accountName: line(100),
  accountNo: z
    .string()
    .transform((s) => s.replace(/\s+/g, ""))
    .pipe(z.string().regex(/^[0-9]{6,20}$/, "6–20 digits.")),
  bankName: line(100),
  branch: line(100),
  ifsc: upperNoSpaces.pipe(z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Enter an 11-character IFSC, e.g. ICIC0000584.")),
  swift: z.preprocess(
    blankToNull,
    upperNoSpaces.pipe(z.string().regex(/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/, "Enter an 8- or 11-character SWIFT code.")).nullable(),
  ).default(null),
});

/**
 * Masti's own details (docs/decisions/0008-visa-docket-dispatch.md Decision 5, docs/decisions/0009-visa-invoice.md
 * Decision 8): the "From" on the parcel sticker and the invoice's header and footer. Data, not a reason or a status, so
 * text is allowed. The tax and bank details start empty: the Head types them in (decided 13 Oct 2026).
 */
export const companyDetailsSchema = z.object({
  name: line(100),
  address: line(300),
  phone: line(30),
  /** The 24/7 number. */
  phone2: stored(line(30)),
  email: stored(email),
  website: stored(website),
  pan: stored(pan),
  gstin: stored(gstin),
  /** GST state code, "24" for Gujarat: decides CGST + SGST or IGST on invoices. */
  stateCode: stored(stateCode),
  bank: stored(bankSchema),
});

export const updateCompanyDetailsSchema = z.object({
  name: line(100).optional(),
  address: line(300).optional(),
  phone: line(30).optional(),
  phone2: clearable(line(30)),
  email: clearable(email),
  website: clearable(website),
  pan: clearable(pan),
  gstin: clearable(gstin),
  stateCode: clearable(stateCode),
  /** Sent and replaced as a whole; null clears it. */
  bank: z.preprocess((v) => (v === "" ? null : v), bankSchema.nullable()).optional(),
});

/** The invoice's terms (0009 Decision 8): an ordered list of lines. Blank lines are dropped. */
export const invoiceTermsSchema = z.object({
  lines: z.preprocess(
    (v) => (Array.isArray(v) ? v.filter((l) => !(typeof l === "string" && l.trim() === "")) : v),
    z.array(line(200)).min(1, "Give at least one term.").max(10, "10 terms at most."),
  ),
});

export const companyImageKindSchema = z.enum(["logo", "signature"], "Upload a logo or a signature.");

export type CompanyDetails = z.infer<typeof companyDetailsSchema>;
export type BankDetails = z.infer<typeof bankSchema>;
export type UpdateCompanyDetailsInput = z.infer<typeof updateCompanyDetailsSchema>;
export type InvoiceTerms = z.infer<typeof invoiceTermsSchema>;
export type CompanyImageKindParam = z.infer<typeof companyImageKindSchema>;
