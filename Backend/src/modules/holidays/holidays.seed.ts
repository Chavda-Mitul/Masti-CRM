import type { Db } from "../../config/prisma";
import { istToday, toDbDate } from "../../lib/dates";
import { DEFAULT_HOLIDAY_SETTINGS, HOLIDAY_SETTINGS_KEY } from "./holidays.settings";

// Seeds the holiday-calendar setting and the weekly Sunday off (docs/decisions/0005-system-masters.md §1).
// "Every Sunday · Weekly off" for all embassies and our office is data, not code ⚠️ (Q38): Masti can remove it or add
// Saturdays without a deploy. It's only added when no weekly Sunday entry exists (removed ones count), so re-seeding
// never brings back one Masti took off.

export async function seedHolidays(db: Db) {
  await db.setting.upsert({ where: { key: HOLIDAY_SETTINGS_KEY }, update: {}, create: { key: HOLIDAY_SETTINGS_KEY, value: DEFAULT_HOLIDAY_SETTINGS } });

  if (await db.holiday.findFirst({ where: { repeat: "WEEKLY", weekday: 7 } })) return;
  await db.holiday.create({
    data: {
      name: "Weekly off",
      repeat: "WEEKLY",
      weekday: 7,
      startDate: toDbDate(istToday()),
      status: "ACTIVE",
      targets: { create: [{ kind: "ALL_EMBASSIES" }, { kind: "MASTI_OFFICE" }] },
    },
  });
}
