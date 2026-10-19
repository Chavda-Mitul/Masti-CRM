import { z } from "zod";
import { EnquiryReasonKind } from "../../../generated/prisma/enums";
import { timeOfDay } from "../../lib/shared.schemas";

// Follow-up and reason dropdowns (docs/decisions/0006-visa-documents.md Decision 7).
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

/** Follow-up outcomes ("What happened") and next steps share a shape. */
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

/** A reason belongs to one action. The kind is set on create and never changes, like the code. */
export const createReasonSchema = createOptionSchema.extend({ kind: z.enum(EnquiryReasonKind) });
export const updateReasonSchema = updateOptionSchema;

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
export type CreateReasonInput = z.infer<typeof createReasonSchema>;
export type UpdateReasonInput = z.infer<typeof updateReasonSchema>;
export type CreateSlotInput = z.infer<typeof createSlotSchema>;
export type UpdateSlotInput = z.infer<typeof updateSlotSchema>;
