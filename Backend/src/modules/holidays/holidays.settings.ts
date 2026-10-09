import { prisma, type Db } from "../../config/prisma";
import { holidaySettingsSchema, type HolidaySettings } from "./holidays.schemas";

// Holiday-calendar rules Masti can change without a deploy (§7 rule 1). One row in the Setting table; the Head edits it.

export const HOLIDAY_SETTINGS_KEY = "holidays";

/** newForDays ⚠️ our guess for the demo's "new" chip. */
export const DEFAULT_HOLIDAY_SETTINGS: HolidaySettings = { newForDays: 7 };

/** Current settings. A missing or invalid row falls back to the default. */
export async function getHolidaySettings(db: Db = prisma): Promise<HolidaySettings> {
  const row = await db.setting.findUnique({ where: { key: HOLIDAY_SETTINGS_KEY } });
  const parsed = holidaySettingsSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : DEFAULT_HOLIDAY_SETTINGS;
}
