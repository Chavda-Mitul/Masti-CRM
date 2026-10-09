import { prisma, type Db } from "../../config/prisma";
import { firstFollowUpSchema, type FirstFollowUp, type VisaSettings } from "./visa.schemas";

// Visa timing Masti can change without a deploy (§7 rule 1, M5). One Setting row per key.
// Document reminders (visa.documentReminders in 0003) come with the WhatsApp work.

export const FIRST_FOLLOW_UP_KEY = "visa.firstFollowUp";

/** ⚠️ The demo: "A follow-up lands on Aarti's desk for tomorrow", at the reminder time 11:00. */
export const DEFAULT_FIRST_FOLLOW_UP: FirstFollowUp = { afterDays: 1, at: "11:00" };

/** Current settings. A missing or invalid row falls back to the default. */
export async function getVisaSettings(db: Db = prisma): Promise<VisaSettings> {
  const row = await db.setting.findUnique({ where: { key: FIRST_FOLLOW_UP_KEY } });
  const parsed = firstFollowUpSchema.safeParse(row?.value);
  return { firstFollowUp: parsed.success ? parsed.data : DEFAULT_FIRST_FOLLOW_UP };
}
