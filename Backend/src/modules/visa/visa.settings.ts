import { prisma, type Db } from "../../config/prisma";
import {
  docketSettingSchema,
  finalFileSchema,
  firstFollowUpSchema,
  invoiceSettingSchema,
  stickerSettingSchema,
  vendorConfirmSchema,
  awbSettingSchema,
  type AwbSetting,
  type DocketSetting,
  type FinalFileSetting,
  type FirstFollowUp,
  type InvoiceSetting,
  type StickerSetting,
  type VendorConfirmSetting,
  type VisaSettings,
} from "./visa.schemas";

// Visa timing Masti can change without a deploy (§7 rule 1, M5). One Setting row per key.
// Document reminders (visa.documentReminders in 0003) come with the WhatsApp work.

export const FIRST_FOLLOW_UP_KEY = "visa.firstFollowUp";
export const FINAL_FILE_KEY = "visa.finalFile";
export const DOCKET_KEY = "visa.docket";
export const STICKER_KEY = "visa.sticker";
export const INVOICE_KEY = "visa.invoice";
export const VENDOR_CONFIRM_KEY = "visa.vendorConfirm";
export const AWB_KEY = "visa.awb";

/** ⚠️ The demo: "A follow-up lands on Aarti's desk for tomorrow", at the reminder time 11:00. */
export const DEFAULT_FIRST_FOLLOW_UP: FirstFollowUp = { afterDays: 1, at: "11:00" };

/** ⚠️ 0007 Decision 8: the final file is one scanned PDF of at most 50 MB. */
export const DEFAULT_FINAL_FILE: FinalFileSetting = { maxMb: 50 };

/** ⚠️ 0008 Decision 7: dockets are numbered "D-2026-0001" (the demo shows "D-121"). */
export const DEFAULT_DOCKET: DocketSetting = { prefix: "D" };

/** ⚠️ 0008 Decision 5: a 100 × 150 mm thermal label; Masti has no particular printer (13 Oct 2026). */
export const DEFAULT_STICKER: StickerSetting = { widthMm: 100, heightMm: 150 };

/**
 * ⚠️ 0009 Decisions 3 and 4: Masti's series MVI + 8 digits (the Head sets startAt at go-live to follow their last
 * voucher), GST 18% on the service charge, SAC 998559 (from their current invoices).
 */
export const DEFAULT_INVOICE: InvoiceSetting = { prefix: "MVI", digits: 8, startAt: 1, gstRatePercent: 18, sac: "998559" };

/** ⚠️ 0008 Decision 9 and §10.9: the processor confirms the vendor got it the next office day, at 11:00 (the demo). */
export const DEFAULT_VENDOR_CONFIRM: VendorConfirmSetting = { afterDays: 1, at: "11:00" };

/** ⚠️ 0008 Decision 6: a slip number is 4–30 capitals and digits (ours; Masti's couriers' formats aren't known). */
export const DEFAULT_AWB: AwbSetting = { minLength: 4, maxLength: 30 };

/** Current settings. A missing or invalid row falls back to the default. */
export async function getVisaSettings(db: Db = prisma): Promise<VisaSettings> {
  const keys = [FIRST_FOLLOW_UP_KEY, FINAL_FILE_KEY, DOCKET_KEY, STICKER_KEY, INVOICE_KEY, VENDOR_CONFIRM_KEY, AWB_KEY];
  const rows = await db.setting.findMany({ where: { key: { in: keys } } });
  const value = (key: string) => rows.find((r) => r.key === key)?.value;
  const firstFollowUp = firstFollowUpSchema.safeParse(value(FIRST_FOLLOW_UP_KEY));
  const finalFile = finalFileSchema.safeParse(value(FINAL_FILE_KEY));
  const docket = docketSettingSchema.safeParse(value(DOCKET_KEY));
  const sticker = stickerSettingSchema.safeParse(value(STICKER_KEY));
  const invoice = invoiceSettingSchema.safeParse(value(INVOICE_KEY));
  const vendorConfirm = vendorConfirmSchema.safeParse(value(VENDOR_CONFIRM_KEY));
  const awb = awbSettingSchema.safeParse(value(AWB_KEY));
  return {
    firstFollowUp: firstFollowUp.success ? firstFollowUp.data : DEFAULT_FIRST_FOLLOW_UP,
    finalFile: finalFile.success ? finalFile.data : DEFAULT_FINAL_FILE,
    docket: docket.success ? docket.data : DEFAULT_DOCKET,
    sticker: sticker.success ? sticker.data : DEFAULT_STICKER,
    invoice: invoice.success ? invoice.data : DEFAULT_INVOICE,
    vendorConfirm: vendorConfirm.success ? vendorConfirm.data : DEFAULT_VENDOR_CONFIRM,
    awb: awb.success ? awb.data : DEFAULT_AWB,
  };
}
