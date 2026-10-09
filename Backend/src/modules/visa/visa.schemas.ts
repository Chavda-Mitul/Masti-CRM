import { z } from "zod";

// Only zod is imported here, so these schemas can later be shared with the frontend.

/** Sanity limits on the travellers per case, not business rules. */
export const MAX_ADULTS = 30;
export const MAX_CHILDREN = 30;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm, e.g. 11:00.");

/** When the first follow-up of a new visa enquiry is due: afterDays days later, at `at` (IST). */
export const firstFollowUpSchema = z.object({
  afterDays: z.number().int().min(0).max(30),
  at: hhmm,
});

export const visaSettingsSchema = z.object({ firstFollowUp: firstFollowUpSchema });
export const updateVisaSettingsSchema = visaSettingsSchema.partial();

/** "Save enquiry" on the New enquiry form. The mobile is normalised by the service (same message as the clients module). */
export const createVisaCaseSchema = z
  .object({
    mobile: z.string().trim().min(1, "Enter the client's mobile number.").max(20),
    /** Needed when the number is new or its client has no name yet; never overwrites an existing name. */
    clientName: z.string().trim().max(150).nullish(),
    sourceCode: z.string().trim().min(1, "Pick where the enquiry came in.").max(40),
    offeringId: z.number().int().positive("Pick a country and visa type."),
    adults: z.number().int().min(1, "At least one adult travels.").max(MAX_ADULTS),
    children: z.number().int().min(0).max(MAX_CHILDREN),
    travelMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick the travel month."),
    travelDate: z.iso.date("Use a valid date.").nullish(),
  })
  .refine((v) => !v.travelDate || v.travelDate.slice(0, 7) === v.travelMonth, {
    path: ["travelDate"],
    message: "The travel date must fall in the travel month.",
  });

/** Idempotency-Key header: any short opaque token (the frontend sends a UUID). */
export const idempotencyKeySchema = z.string().trim().min(8).max(100).optional();

export type FirstFollowUp = z.infer<typeof firstFollowUpSchema>;
export type VisaSettings = z.infer<typeof visaSettingsSchema>;
export type UpdateVisaSettingsInput = z.infer<typeof updateVisaSettingsSchema>;
export type CreateVisaCaseInput = z.infer<typeof createVisaCaseSchema>;
