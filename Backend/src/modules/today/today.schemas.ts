import { z } from "zod";
import { timeOfDay } from "../../lib/shared.schemas";

// The Today page (docs/decisions/0017-today-dashboard.md). Only zod and other schema files are imported here, so these
// schemas can later be shared with the frontend.

/** The Today page's rule Masti can change without a deploy (§7 rule 1). */
export const todaySettingsSchema = z.object({
  /** "New enquiries" count from this time on the previous office day: the demo's "since yesterday evening" ⚠️. */
  newSinceAt: timeOfDay,
});

export const updateTodaySettingsSchema = todaySettingsSchema.partial();

export type TodaySettings = z.infer<typeof todaySettingsSchema>;
export type UpdateTodaySettingsInput = z.infer<typeof updateTodaySettingsSchema>;
