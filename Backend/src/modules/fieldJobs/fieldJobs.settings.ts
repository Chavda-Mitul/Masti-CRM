import { prisma, type Db } from "../../config/prisma";
import { fieldSettingsSchema, type FieldSettings } from "./field.schemas";

// The field staff app's values Masti can change without a deploy (§7 rule 1; docs/decisions/0015-field-staff-app.md
// Decision 8). One row in the Setting table; the Head or any HOD changes it.

export const FIELD_SETTINGS_KEY = "field";

/** ⚠️ Our defaults (0015 Decision 8): the code works 10 minutes, takes 5 wrong tries, another after 60 seconds; 5 MB. */
export const DEFAULT_FIELD_SETTINGS: FieldSettings = { otpMinutes: 10, otpTries: 5, otpResendSeconds: 60, selfieMaxMb: 5 };

/** Current settings. A missing or invalid row falls back to the defaults. */
export async function getFieldSettings(db: Db = prisma): Promise<FieldSettings> {
  const row = await db.setting.findUnique({ where: { key: FIELD_SETTINGS_KEY } });
  const parsed = fieldSettingsSchema.safeParse(row?.value);
  return parsed.success ? parsed.data : DEFAULT_FIELD_SETTINGS;
}
