import { z } from "zod";

// The field staff app's own requests (docs/decisions/0015-field-staff-app.md). Only zod is imported here, so these
// schemas can later be shared with the frontend.

/** His run for a day (phase 3): YYYY-MM-DD in India; today when left out. */
export const myRunQuerySchema = z.object({
  day: z.iso.date("Pick a day as YYYY-MM-DD.").optional(),
});
