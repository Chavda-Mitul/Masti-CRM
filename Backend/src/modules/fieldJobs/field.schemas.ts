import { z } from "zod";

// The field staff app's own requests (docs/decisions/0015-field-staff-app.md). Only zod is imported here, so these
// schemas can later be shared with the frontend.

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

export type Place = z.infer<typeof placeSchema>;
export type MarkFailedInput = z.infer<typeof markFailedSchema>;
