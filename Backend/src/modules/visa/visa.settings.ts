import { prisma, type Db } from "../../config/prisma";
import {
  docketSettingSchema,
  finalFileSchema,
  firstFollowUpSchema,
  type DocketSetting,
  type FinalFileSetting,
  type FirstFollowUp,
  type VisaSettings,
} from "./visa.schemas";

// Visa timing Masti can change without a deploy (§7 rule 1, M5). One Setting row per key.
// Document reminders (visa.documentReminders in 0003) come with the WhatsApp work.

export const FIRST_FOLLOW_UP_KEY = "visa.firstFollowUp";
export const FINAL_FILE_KEY = "visa.finalFile";
export const DOCKET_KEY = "visa.docket";

/** ⚠️ The demo: "A follow-up lands on Aarti's desk for tomorrow", at the reminder time 11:00. */
export const DEFAULT_FIRST_FOLLOW_UP: FirstFollowUp = { afterDays: 1, at: "11:00" };

/** ⚠️ 0007 Decision 8: the final file is one scanned PDF of at most 50 MB. */
export const DEFAULT_FINAL_FILE: FinalFileSetting = { maxMb: 50 };

/** ⚠️ 0008 Decision 7: dockets are numbered "D-2026-0001" (the demo shows "D-121"). */
export const DEFAULT_DOCKET: DocketSetting = { prefix: "D" };

/** Current settings. A missing or invalid row falls back to the default. */
export async function getVisaSettings(db: Db = prisma): Promise<VisaSettings> {
  const rows = await db.setting.findMany({ where: { key: { in: [FIRST_FOLLOW_UP_KEY, FINAL_FILE_KEY, DOCKET_KEY] } } });
  const value = (key: string) => rows.find((r) => r.key === key)?.value;
  const firstFollowUp = firstFollowUpSchema.safeParse(value(FIRST_FOLLOW_UP_KEY));
  const finalFile = finalFileSchema.safeParse(value(FINAL_FILE_KEY));
  const docket = docketSettingSchema.safeParse(value(DOCKET_KEY));
  return {
    firstFollowUp: firstFollowUp.success ? firstFollowUp.data : DEFAULT_FIRST_FOLLOW_UP,
    finalFile: finalFile.success ? finalFile.data : DEFAULT_FINAL_FILE,
    docket: docket.success ? docket.data : DEFAULT_DOCKET,
  };
}
