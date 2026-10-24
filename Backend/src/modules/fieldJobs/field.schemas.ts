import { z } from "zod";
import { confirmWarnings } from "../../lib/shared.schemas";
import { handOverBookletsSchema, receiverSchema } from "../visa/visa.schemas";

// The field staff app's own requests (docs/decisions/0015-field-staff-app.md). Only zod and other *.schemas.ts files
// are imported here, so these schemas can later be shared with the frontend.

/** His run for a day (phase 3): YYYY-MM-DD in India; today when left out. */
export const myRunQuerySchema = z.object({
  day: z.iso.date("Pick a day as YYYY-MM-DD.").optional(),
});

const NO_PLACE = "Your phone's location is needed. Allow it, then try again.";

/**
 * Where his phone says he is (golden rule 5: the place for field actions): latitude and longitude in degrees, and how
 * sure the phone is, in metres (kept whole).
 */
export const placeSchema = z.object(
  {
    lat: z.number(NO_PLACE).min(-90, NO_PLACE).max(90, NO_PLACE),
    lng: z.number(NO_PLACE).min(-180, NO_PLACE).max(180, NO_PLACE),
    accuracy: z
      .number(NO_PLACE)
      .min(0, NO_PLACE)
      .max(1_000_000, NO_PLACE)
      .transform((m) => Math.round(m)),
  },
  NO_PLACE,
);

/** "Couldn't complete" (Decision 5): a reason from the list, and the place. */
export const markFailedSchema = z.object({
  reasonId: z.number("Pick a reason.").int().positive("Pick a reason."),
  place: placeSchema,
});

/**
 * The field staff app's ⚠️ values (docs/decisions/0015-field-staff-app.md Decision 8), one setting the Head or any HOD
 * changes: how long the client's code works, the wrong tries it takes, the wait before another can be sent (also the
 * office handover's code, docs/decisions/0014-visa-delivered.md Decision 2, amended 23 Oct 2026), and the largest selfie.
 */
export const fieldSettingsSchema = z.object({
  otpMinutes: z.number().int().min(1).max(60),
  otpTries: z.number().int().min(1).max(10),
  otpResendSeconds: z.number().int().min(10).max(600),
  selfieMaxMb: z.number().int().min(1).max(20),
});
export const updateFieldSettingsSchema = fieldSettingsSchema.partial();

const COUNT = "Count the booklets: current and old (0 if none).";
const booklets = z.number(COUNT).int(COUNT).min(0, COUNT).max(50, "At most 50 booklets.");

/** "Picked up" (Decision 4): the booklets he counted, his selfie (uploaded as he took it) and the place. */
export const markDoneSchema = z.object({
  booklets: z.object({ current: booklets, old: booklets }, COUNT),
  selfieId: z.string("Take your selfie at the door.").min(1, "Take your selfie at the door."),
  place: placeSchema,
});

/**
 * The handover at the door (Decision 4, phase 5): the booklets he counted (they must match our stock), who receives
 * them (a traveller on the case, or someone else by name), their photo and his selfie (each uploaded as he took it),
 * and the place, once the client confirmed the code.
 */
export const handOverAtDoorSchema = z.object({
  booklets: handOverBookletsSchema,
  receiver: receiverSchema,
  photoId: z.string("Take a photo of the person receiving.").min(1, "Take a photo of the person receiving."),
  selfieId: z.string("Take your selfie at the door.").min(1, "Take your selfie at the door."),
  place: placeSchema,
  /** Handing over again past a warning (a child picked as who receives them). */
  confirmWarnings,
});

export type Place = z.infer<typeof placeSchema>;
export type MarkFailedInput = z.infer<typeof markFailedSchema>;
export type FieldSettings = z.infer<typeof fieldSettingsSchema>;
export type UpdateFieldSettingsInput = z.infer<typeof updateFieldSettingsSchema>;
export type MarkDoneInput = z.infer<typeof markDoneSchema>;
export type HandOverAtDoorInput = z.infer<typeof handOverAtDoorSchema>;
