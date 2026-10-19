import { z } from "zod";
import { EnquiryReasonKind } from "../../../generated/prisma/enums";
import { timeOfDay } from "../../lib/shared.schemas";

// Follow-up and reason dropdowns (docs/decisions/0006-visa-documents.md Decision 7, tagged by department in 0018).
// Only zod and the generated enums are imported here, so these schemas can later be shared with the frontend.
// Codes are stable keys (the seed uses them), so they are set on create and never change.

const text = (max: number) => z.string().trim().min(1, "This can't be empty.").max(max);
const sortOrder = z.number().int().min(0).max(9999);
const keyCode = z
  .string()
  .transform((s) => s.trim().toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9_]{1,40}$/, "Use up to 40 letters, digits or underscores, e.g. NO_ANSWER."));

/** ?active=true / false filters lists; omitted lists everything. */
export const listQuerySchema = z.object({
  active: z.enum(["true", "false"]).optional().transform((v) => (v === undefined ? undefined : v === "true")),
});

/** A plain list value, e.g. why a field visit fails. */
export const createOptionSchema = z.object({
  code: keyCode,
  name: text(80),
  sortOrder: sortOrder.default(0),
  isActive: z.boolean().default(true),
});
export const updateOptionSchema = z.object({
  name: text(80).optional(),
  sortOrder: sortOrder.optional(),
  isActive: z.boolean().optional(),
});

/**
 * The departments a follow-up or reason value shows in (docs/decisions/0018-dropdowns-by-department.md), by code. At
 * least one. Sent on an edit, it replaces the whole set.
 */
const departments = z
  .array(z.string().trim().toUpperCase().min(1).max(40))
  .min(1, "Pick at least one department.")
  .max(20)
  .transform((codes) => [...new Set(codes)]);

/** Follow-up outcomes ("What happened") and next steps share a shape: a plain value tagged with departments. */
export const createTaggedOptionSchema = createOptionSchema.extend({ departments });
export const updateTaggedOptionSchema = updateOptionSchema.extend({ departments: departments.optional() });

/** A reason belongs to one action. The kind is set on create and never changes, like the code. */
export const createReasonSchema = createTaggedOptionSchema.extend({ kind: z.enum(EnquiryReasonKind) });
export const updateReasonSchema = updateTaggedOptionSchema;

/** A time slot the collection and delivery boy is booked for (docs/decisions/0015-field-staff-app.md Decision 2). */
export const createSlotSchema = z
  .object({ code: keyCode, name: text(40), startsAt: timeOfDay, endsAt: timeOfDay, sortOrder: sortOrder.default(0), isActive: z.boolean().default(true) })
  .refine((s) => s.endsAt > s.startsAt, { path: ["endsAt"], message: "The slot must end after it starts." });
/** The service checks the end is still after the start, with the times it doesn't change. */
export const updateSlotSchema = z.object({
  name: text(40).optional(),
  startsAt: timeOfDay.optional(),
  endsAt: timeOfDay.optional(),
  sortOrder: sortOrder.optional(),
  isActive: z.boolean().optional(),
});

export type CreateOptionInput = z.infer<typeof createOptionSchema>;
export type UpdateOptionInput = z.infer<typeof updateOptionSchema>;
export type CreateTaggedOptionInput = z.infer<typeof createTaggedOptionSchema>;
export type UpdateTaggedOptionInput = z.infer<typeof updateTaggedOptionSchema>;
export type CreateReasonInput = z.infer<typeof createReasonSchema>;
export type UpdateReasonInput = z.infer<typeof updateReasonSchema>;
export type CreateSlotInput = z.infer<typeof createSlotSchema>;
export type UpdateSlotInput = z.infer<typeof updateSlotSchema>;
