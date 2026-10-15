import { z } from "zod";
import { DocumentRequirement, TravellerGroup } from "../../../generated/prisma/enums";

// Only zod and the generated enums are imported here, so these schemas can later be shared with the frontend.
// Codes are stable keys (the seed and the holiday bot use them), so they are set on create and never change.

/** "" and null both clear a field; a missing key means "not sent". */
const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const clearable = <T extends z.ZodType>(schema: T) => z.preprocess(blankToNull, schema.nullable()).optional();

const text = (max: number) => z.string().trim().min(1, "This can't be empty.").max(max);
const upper = z.string().transform((s) => s.trim().toUpperCase());
const sortOrder = z.number().int().min(0).max(9999);
const id = z.number().int().positive();

export const countryCode = upper.pipe(z.string().regex(/^[A-Z]{2}$/, "Use the 2-letter country code, e.g. FR."));
export const embassyCode = upper.pipe(z.string().regex(/^[A-Z0-9-]{2,20}$/, "Use 2–20 letters, digits or dashes, e.g. FR-MUM."));
const keyCode = upper.pipe(z.string().regex(/^[A-Z0-9_]{1,40}$/, "Use up to 40 letters, digits or underscores, e.g. BANK_STATEMENT_6M."));

/** ?active=true / false filters lists; omitted lists everything. */
export const listQuerySchema = z.object({
  active: z.enum(["true", "false"]).optional().transform((v) => (v === undefined ? undefined : v === "true")),
});

export const embassyListQuerySchema = listQuerySchema.extend({
  countryId: z.coerce.number().int().positive().optional(),
});

export const createCountrySchema = z.object({
  code: countryCode,
  name: text(80),
  zone: clearable(text(40)),
  sortOrder: sortOrder.default(0),
  isActive: z.boolean().default(true),
});
export const updateCountrySchema = z.object({
  name: text(80).optional(),
  zone: clearable(text(40)),
  sortOrder: sortOrder.optional(),
  isActive: z.boolean().optional(),
});

export const createVisaTypeSchema = z.object({
  code: keyCode,
  name: text(80),
  sortOrder: sortOrder.default(0),
  isActive: z.boolean().default(true),
});
export const updateVisaTypeSchema = z.object({
  name: text(80).optional(),
  sortOrder: sortOrder.optional(),
  isActive: z.boolean().optional(),
});

export const createEmbassySchema = z.object({
  code: embassyCode,
  countryId: id,
  name: text(120),
  city: text(80),
  sortOrder: sortOrder.default(0),
  isActive: z.boolean().default(true),
});
export const updateEmbassySchema = z.object({
  name: text(120).optional(),
  city: text(80).optional(),
  sortOrder: sortOrder.optional(),
  isActive: z.boolean().optional(),
});

export const createDocumentSchema = z.object({
  code: keyCode,
  name: text(150),
  detail: clearable(text(300)),
  sortOrder: sortOrder.default(0),
  isActive: z.boolean().default(true),
});
export const updateDocumentSchema = z.object({
  name: text(150).optional(),
  detail: clearable(text(300)),
  sortOrder: sortOrder.optional(),
  isActive: z.boolean().optional(),
});

/** Why a paper needs replacing in Step 3 ("Not signed"), docs/decisions/0007-visa-file-prep.md Decision 3. */
export const createDocumentProblemReasonSchema = z.object({
  code: keyCode,
  name: text(80),
  sortOrder: sortOrder.default(0),
  isActive: z.boolean().default(true),
});
export const updateDocumentProblemReasonSchema = z.object({
  name: text(80).optional(),
  sortOrder: sortOrder.optional(),
  isActive: z.boolean().optional(),
});

/** How fast the embassy processes an application (docs/decisions/0009-visa-invoice.md): picked on the quote. */
export const createProcessingSpeedSchema = z.object({
  code: keyCode,
  name: text(80),
  sortOrder: sortOrder.default(0),
  isActive: z.boolean().default(true),
});
export const updateProcessingSpeedSchema = z.object({
  name: text(80).optional(),
  sortOrder: sortOrder.optional(),
  isActive: z.boolean().optional(),
});

/** How a docket goes to the vendor (docs/decisions/0008-visa-docket-dispatch.md Decision 6): picked at dispatch. */
export const createCourierSchema = z.object({
  code: keyCode,
  name: text(80),
  awbNeeded: z.boolean().default(true),
  sortOrder: sortOrder.default(0),
  isActive: z.boolean().default(true),
});
export const updateCourierSchema = z.object({
  name: text(80).optional(),
  awbNeeded: z.boolean().optional(),
  sortOrder: sortOrder.optional(),
  isActive: z.boolean().optional(),
});

/** Why a credit note is issued (docs/decisions/0011-visa-at-vendor.md Decision 5): picked, never typed. */
export const createCreditNoteReasonSchema = z.object({
  code: keyCode,
  name: text(80),
  sortOrder: sortOrder.default(0),
  isActive: z.boolean().default(true),
});
export const updateCreditNoteReasonSchema = z.object({
  name: text(80).optional(),
  sortOrder: sortOrder.optional(),
  isActive: z.boolean().optional(),
});

/** Why a file is taken back from the vendor (docs/decisions/0011-visa-at-vendor.md Decision 6): picked, never typed. */
export const createRecallReasonSchema = createCreditNoteReasonSchema;
export const updateRecallReasonSchema = updateCreditNoteReasonSchema;

/** What an additional invoice charges for (docs/decisions/0011-visa-at-vendor.md Decision 7): picked, never typed. */
export const createExtraChargeSchema = createCreditNoteReasonSchema;
export const updateExtraChargeSchema = updateCreditNoteReasonSchema;

/** "Came in through" sources. staffSelectable = false hides one from the staff form (integrations set it). */
export const createEnquirySourceSchema = z.object({
  code: keyCode,
  name: text(60),
  sortOrder: sortOrder.default(0),
  isActive: z.boolean().default(true),
  staffSelectable: z.boolean().default(true),
});
export const updateEnquirySourceSchema = z.object({
  name: text(60).optional(),
  sortOrder: sortOrder.optional(),
  isActive: z.boolean().optional(),
  staffSelectable: z.boolean().optional(),
});

export const createOfferingSchema = z.object({ countryId: id, visaTypeId: id });
/**
 * Switching the visa off or on, and what "File ready" asks for (docs/decisions/0007-visa-file-prep.md Decision 6):
 * a portal appointment for every traveller, and a vendor. Both are off for e-visas.
 */
export const updateOfferingSchema = z
  .object({
    isActive: z.boolean().optional(),
    appointmentNeeded: z.boolean().optional(),
    vendorNeeded: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((value) => value !== undefined), { message: "Nothing to change." });

export const MAX_CHECKLIST_ITEMS = 60;

export const checklistItemSchema = z.object({
  documentId: id,
  requirement: z.enum(DocumentRequirement),
  appliesTo: z.enum(TravellerGroup).default("ALL"),
  quantity: z.number().int().min(1).max(20).default(1),
  note: clearable(text(200)),
});

/** Replaces the whole checklist. The array order becomes the order on the list. */
export const replaceChecklistSchema = z.object({
  /** The offering's updatedAt the screen read. A mismatch means someone else saved in between. */
  updatedAt: z.iso.datetime("Reload and try again."),
  items: z
    .array(checklistItemSchema)
    .min(1, "A checklist needs at least one document.")
    .max(MAX_CHECKLIST_ITEMS)
    .refine((items) => new Set(items.map((i) => i.documentId)).size === items.length, "Each document can be on the checklist only once."),
});

export type CreateCountryInput = z.infer<typeof createCountrySchema>;
export type UpdateCountryInput = z.infer<typeof updateCountrySchema>;
export type CreateVisaTypeInput = z.infer<typeof createVisaTypeSchema>;
export type UpdateVisaTypeInput = z.infer<typeof updateVisaTypeSchema>;
export type CreateEmbassyInput = z.infer<typeof createEmbassySchema>;
export type UpdateEmbassyInput = z.infer<typeof updateEmbassySchema>;
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;
export type CreateDocumentProblemReasonInput = z.infer<typeof createDocumentProblemReasonSchema>;
export type UpdateDocumentProblemReasonInput = z.infer<typeof updateDocumentProblemReasonSchema>;
export type CreateProcessingSpeedInput = z.infer<typeof createProcessingSpeedSchema>;
export type UpdateProcessingSpeedInput = z.infer<typeof updateProcessingSpeedSchema>;
export type CreateCourierInput = z.infer<typeof createCourierSchema>;
export type UpdateCourierInput = z.infer<typeof updateCourierSchema>;
export type CreateCreditNoteReasonInput = z.infer<typeof createCreditNoteReasonSchema>;
export type UpdateCreditNoteReasonInput = z.infer<typeof updateCreditNoteReasonSchema>;
export type CreateRecallReasonInput = z.infer<typeof createRecallReasonSchema>;
export type UpdateRecallReasonInput = z.infer<typeof updateRecallReasonSchema>;
export type CreateExtraChargeInput = z.infer<typeof createExtraChargeSchema>;
export type UpdateExtraChargeInput = z.infer<typeof updateExtraChargeSchema>;
export type CreateEnquirySourceInput = z.infer<typeof createEnquirySourceSchema>;
export type UpdateEnquirySourceInput = z.infer<typeof updateEnquirySourceSchema>;
export type CreateOfferingInput = z.infer<typeof createOfferingSchema>;
export type UpdateOfferingInput = z.infer<typeof updateOfferingSchema>;
export type ReplaceChecklistInput = z.infer<typeof replaceChecklistSchema>;
