import { prisma, type Db } from "../../config/prisma";
import { todaySettingsSchema, type TodaySettings } from "./today.schemas";

// The Today page's rule Masti can change without a deploy (§7 rule 1). One row in the Setting table; the Head edits it.

export const TODAY_SETTINGS_KEY = "today";

/** newSinceAt ⚠️ our guess at the demo's "since yesterday evening" (docs/decisions/0017-today-dashboard.md Decision 3). */
export const DEFAULT_TODAY_SETTINGS: TodaySettings = { newSinceAt: "18:00" };

/** Current settings. A missing or invalid row falls back to the default. */
export async function getTodaySettings(db: Db = prisma): Promise<TodaySettings> {
  const row = await db.setting.findUnique({ where: { key: TODAY_SETTINGS_KEY } });
  const parsed = todaySettingsSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : DEFAULT_TODAY_SETTINGS;
}
