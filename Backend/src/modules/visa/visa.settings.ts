import { prisma, type Db } from "../../config/prisma";
import { addDays, istDateTimeToUtc, istToday } from "../../lib/dates";
import { nextOpenDay, previousOpenDay } from "../holidays/blockedDays";
import {
  docketSettingSchema,
  finalFileSchema,
  firstFollowUpSchema,
  invoiceSettingSchema,
  creditNoteSettingSchema,
  stickerSettingSchema,
  vendorConfirmSchema,
  awbSettingSchema,
  docketEmailSettingSchema,
  onlineCheckSchema,
  submissionCheckSchema,
  recallReturnSchema,
  passportsBackCheckSchema,
  arrivalCheckSchema,
  assignCheckSchema,
  handoverCheckSchema,
  handoverPhotoSchema,
  collectionCheckSchema,
  documentRemindersSchema,
  type AwbSetting,
  type CollectionCheckSetting,
  type DocketEmailSetting,
  type DocketSetting,
  type DocumentRemindersSetting,
  type FinalFileSetting,
  type FirstFollowUp,
  type InvoiceSetting,
  type CreditNoteSetting,
  type OnlineCheckSetting,
  type StickerSetting,
  type SubmissionCheckSetting,
  type RecallReturnSetting,
  type PassportsBackCheckSetting,
  type ArrivalCheckSetting,
  type AssignCheckSetting,
  type HandoverCheckSetting,
  type HandoverPhotoSetting,
  type VendorConfirmSetting,
  type VisaSettings,
} from "./visa.schemas";

// Visa timing Masti can change without a deploy (§7 rule 1, M5). One Setting row per key.

export const FIRST_FOLLOW_UP_KEY = "visa.firstFollowUp";
export const FINAL_FILE_KEY = "visa.finalFile";
export const DOCKET_KEY = "visa.docket";
export const STICKER_KEY = "visa.sticker";
export const INVOICE_KEY = "visa.invoice";
export const CREDIT_NOTE_KEY = "visa.creditNote";
export const VENDOR_CONFIRM_KEY = "visa.vendorConfirm";
export const ONLINE_CHECK_KEY = "visa.onlineCheck";
export const SUBMISSION_CHECK_KEY = "visa.submissionCheck";
export const RECALL_RETURN_KEY = "visa.recallReturn";
export const PASSPORTS_BACK_CHECK_KEY = "visa.passportsBackCheck";
export const ARRIVAL_CHECK_KEY = "visa.arrivalCheck";
export const ASSIGN_CHECK_KEY = "visa.assignCheck";
export const HANDOVER_CHECK_KEY = "visa.handoverCheck";
export const HANDOVER_PHOTO_KEY = "visa.handoverPhoto";
export const COLLECTION_CHECK_KEY = "visa.collectionCheck";
export const AWB_KEY = "visa.awb";
export const DOCKET_EMAIL_KEY = "visa.docketEmail";
export const DOCUMENT_REMINDERS_KEY = "visa.documentReminders";

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

/** ⚠️ 0011 Decision 5: Masti has no credit-note series yet, so MCN + 8 digits from 1 (the Head can move it at go-live). */
export const DEFAULT_CREDIT_NOTE: CreditNoteSetting = { prefix: "MCN", digits: 8, startAt: 1 };

/** ⚠️ 0008 Decision 9 and §10.9: the processor confirms the vendor got it the next office day, at 11:00 (the demo). */
export const DEFAULT_VENDOR_CONFIRM: VendorConfirmSetting = { afterDays: 1, at: "11:00" };

/** ⚠️ 0008 Decision 11: an e-visa comes back to check the portal like a couriered file, the next office day at 11:00. */
export const DEFAULT_ONLINE_CHECK: OnlineCheckSetting = { afterDays: 1, at: "11:00" };

/** ⚠️ 0011 Decision 2: with no appointment to wait for, the file number is asked for the next office day at 11:00. */
export const DEFAULT_SUBMISSION_CHECK: SubmissionCheckSetting = { afterDays: 1, at: "11:00" };

/** ⚠️ 0011 Decision 6: after a recall, the processor chases the vendor for the papers the next office day at 11:00. */
export const DEFAULT_RECALL_RETURN: RecallReturnSetting = { afterDays: 1, at: "11:00" };

/** ⚠️ 0012 Decision 7: after the decision, the processor checks the passports are on their way back the next office day at 11:00. */
export const DEFAULT_PASSPORTS_BACK_CHECK: PassportsBackCheckSetting = { afterDays: 1, at: "11:00" };

/** ⚠️ 0013 Decision 3: passports on their way back come back to the processor on the expected day, at 11:00. */
export const DEFAULT_ARRIVAL_CHECK: ArrivalCheckSetting = { afterDays: 0, at: "11:00" };

/** ⚠️ 0006, amended 16 Oct 2026: a matured case is due with the Visa HOD to assign the next office day at 11:00. */
export const DEFAULT_ASSIGN_CHECK: AssignCheckSetting = { afterDays: 1, at: "11:00" };
/** ⚠️ 0013 Decision 5: once the passports are in our stock, the processor arranges the handover the next office day at 11:00. */
export const DEFAULT_HANDOVER_CHECK: HandoverCheckSetting = { afterDays: 1, at: "11:00" };

/** ⚠️ 0014 Decision 6: a receiver photo is at most 5 MB (the browser shrinks it to about 1600 px first). */
export const DEFAULT_HANDOVER_PHOTO: HandoverPhotoSetting = { maxMb: 5 };

/** ⚠️ 0011 Decision 4 and §10.9: reminded the office day before the expected collection date, at 11:00. */
export const DEFAULT_COLLECTION_CHECK: CollectionCheckSetting = { daysBefore: 1, at: "11:00" };

/** ⚠️ 0008 Decision 6: a slip number is 4–30 capitals and digits (ours; Masti's couriers' formats aren't known). */
export const DEFAULT_AWB: AwbSetting = { minLength: 4, maxLength: 30 };

/** ⚠️ 0003 Decision 7 and the demo: "Every 2 days at 11:00 on WhatsApp, listing only what's still missing." */
export const DEFAULT_DOCUMENT_REMINDERS: DocumentRemindersSetting = { enabled: true, everyDays: 2, sendAt: "11:00", channel: "WHATSAPP" };

/** ⚠️ 0008 Decision 8: the email to the vendor at dispatch, in our words until Masti approves them. */
export const DEFAULT_DOCKET_EMAIL: DocketEmailSetting = {
  subject: "Docket {docketNo} · {files} · {company}",
  greeting: "Dear {vendor},",
  opening: "Docket {docketNo} is on its way to you: {files}, {passports} passports.",
  closing: "Please confirm when you receive it.",
};

/**
 * `at` (IST) on `day`, unless that has already passed: then the first open office day from today whose `at` is still to
 * come. A check is never due before it's set (fixed 19 Oct 2026, code review): passports expected today and saved
 * after 11:00 were due at 11:00 that day, late at once, and a reminder clamped to today could land on a closed day.
 */
async function notPast(day: string, at: string, db: Db) {
  const due = istDateTimeToUtc(day, at);
  if (due.getTime() > Date.now()) return due;
  const open = await nextOpenDay(istToday(), { office: true }, db);
  const onOpen = istDateTimeToUtc(open, at);
  if (onOpen.getTime() > Date.now()) return onOpen;
  return istDateTimeToUtc(await nextOpenDay(addDays(open, 1), { office: true }, db), at);
}

/**
 * When a case comes back due on its processor's desk after a step: the next open office day (skipping Sundays and
 * office holidays), `afterDays` from `from` (today unless given), at `at` (IST), never already past (notPast). For the
 * vendor confirmation, the e-visa portal check, the file number, a recalled file's papers, and passports expected back
 * on a day.
 */
export async function dueOnOfficeDay(timing: { afterDays: number; at: string }, db: Db = prisma, from: string = istToday()) {
  const day = await nextOpenDay(addDays(from, timing.afterDays), { office: true }, db);
  return notPast(day, timing.at, db);
}

/**
 * When a case comes back due before a date: the open office day `daysBefore` it (walking back over Sundays and office
 * holidays), at `at` (IST), never already past (notPast). For the collection reminder.
 */
export async function dueBeforeOfficeDay(date: string, timing: { daysBefore: number; at: string }, db: Db = prisma) {
  const day = await previousOpenDay(addDays(date, -timing.daysBefore), { office: true }, db);
  return notPast(day, timing.at, db);
}

/** A sanity bound on the walk forward: 400 reminders is over a year at one a day. */
const MAX_REMINDER_STEPS = 400;

/**
 * When the next pending-document reminder goes out (0006 amendment 19), worked out on each read since nothing sends
 * them yet: every `everyDays` days from `listDay` (the day the document list went out, the intake), at `sendAt` (IST).
 * A Sunday or an office holiday moves a reminder to the next open day, and the one after still counts from its planned
 * day, so the dates don't drift. The first one whose time is still to come; null if none is found within the bound.
 */
export async function nextReminderAt(
  listDay: string,
  setting: Pick<DocumentRemindersSetting, "everyDays" | "sendAt">,
  db: Db = prisma,
  now: Date = new Date(),
): Promise<Date | null> {
  // Start a step before today: a planned day just gone may have moved forward to today or later.
  const elapsed = Math.round((Date.parse(istToday(now)) - Date.parse(listDay)) / 86_400_000);
  const first = Math.max(1, Math.floor(elapsed / setting.everyDays));
  for (let k = first; k < first + MAX_REMINDER_STEPS; k++) {
    const day = await nextOpenDay(addDays(listDay, k * setting.everyDays), { office: true }, db);
    const at = istDateTimeToUtc(day, setting.sendAt);
    if (at.getTime() > now.getTime()) return at;
  }
  return null;
}

/** Current settings. A missing or invalid row falls back to the default. */
export async function getVisaSettings(db: Db = prisma): Promise<VisaSettings> {
  const keys = [FIRST_FOLLOW_UP_KEY, FINAL_FILE_KEY, DOCKET_KEY, STICKER_KEY, INVOICE_KEY, CREDIT_NOTE_KEY, VENDOR_CONFIRM_KEY, ONLINE_CHECK_KEY, SUBMISSION_CHECK_KEY, RECALL_RETURN_KEY, PASSPORTS_BACK_CHECK_KEY, ARRIVAL_CHECK_KEY, ASSIGN_CHECK_KEY, HANDOVER_CHECK_KEY, HANDOVER_PHOTO_KEY, COLLECTION_CHECK_KEY, AWB_KEY, DOCKET_EMAIL_KEY, DOCUMENT_REMINDERS_KEY];
  const rows = await db.setting.findMany({ where: { key: { in: keys } } });
  const value = (key: string) => rows.find((r) => r.key === key)?.value;
  const firstFollowUp = firstFollowUpSchema.safeParse(value(FIRST_FOLLOW_UP_KEY));
  const finalFile = finalFileSchema.safeParse(value(FINAL_FILE_KEY));
  const docket = docketSettingSchema.safeParse(value(DOCKET_KEY));
  const sticker = stickerSettingSchema.safeParse(value(STICKER_KEY));
  const invoice = invoiceSettingSchema.safeParse(value(INVOICE_KEY));
  const creditNote = creditNoteSettingSchema.safeParse(value(CREDIT_NOTE_KEY));
  const vendorConfirm = vendorConfirmSchema.safeParse(value(VENDOR_CONFIRM_KEY));
  const onlineCheck = onlineCheckSchema.safeParse(value(ONLINE_CHECK_KEY));
  const submissionCheck = submissionCheckSchema.safeParse(value(SUBMISSION_CHECK_KEY));
  const recallReturn = recallReturnSchema.safeParse(value(RECALL_RETURN_KEY));
  const passportsBackCheck = passportsBackCheckSchema.safeParse(value(PASSPORTS_BACK_CHECK_KEY));
  const arrivalCheck = arrivalCheckSchema.safeParse(value(ARRIVAL_CHECK_KEY));
  const assignCheck = assignCheckSchema.safeParse(value(ASSIGN_CHECK_KEY));
  const handoverCheck = handoverCheckSchema.safeParse(value(HANDOVER_CHECK_KEY));
  const handoverPhoto = handoverPhotoSchema.safeParse(value(HANDOVER_PHOTO_KEY));
  const collectionCheck = collectionCheckSchema.safeParse(value(COLLECTION_CHECK_KEY));
  const awb = awbSettingSchema.safeParse(value(AWB_KEY));
  const docketEmail = docketEmailSettingSchema.safeParse(value(DOCKET_EMAIL_KEY));
  const documentReminders = documentRemindersSchema.safeParse(value(DOCUMENT_REMINDERS_KEY));
  return {
    firstFollowUp: firstFollowUp.success ? firstFollowUp.data : DEFAULT_FIRST_FOLLOW_UP,
    finalFile: finalFile.success ? finalFile.data : DEFAULT_FINAL_FILE,
    docket: docket.success ? docket.data : DEFAULT_DOCKET,
    sticker: sticker.success ? sticker.data : DEFAULT_STICKER,
    invoice: invoice.success ? invoice.data : DEFAULT_INVOICE,
    creditNote: creditNote.success ? creditNote.data : DEFAULT_CREDIT_NOTE,
    vendorConfirm: vendorConfirm.success ? vendorConfirm.data : DEFAULT_VENDOR_CONFIRM,
    onlineCheck: onlineCheck.success ? onlineCheck.data : DEFAULT_ONLINE_CHECK,
    submissionCheck: submissionCheck.success ? submissionCheck.data : DEFAULT_SUBMISSION_CHECK,
    recallReturn: recallReturn.success ? recallReturn.data : DEFAULT_RECALL_RETURN,
    passportsBackCheck: passportsBackCheck.success ? passportsBackCheck.data : DEFAULT_PASSPORTS_BACK_CHECK,
    arrivalCheck: arrivalCheck.success ? arrivalCheck.data : DEFAULT_ARRIVAL_CHECK,
    assignCheck: assignCheck.success ? assignCheck.data : DEFAULT_ASSIGN_CHECK,
    handoverCheck: handoverCheck.success ? handoverCheck.data : DEFAULT_HANDOVER_CHECK,
    handoverPhoto: handoverPhoto.success ? handoverPhoto.data : DEFAULT_HANDOVER_PHOTO,
    collectionCheck: collectionCheck.success ? collectionCheck.data : DEFAULT_COLLECTION_CHECK,
    awb: awb.success ? awb.data : DEFAULT_AWB,
    docketEmail: docketEmail.success ? docketEmail.data : DEFAULT_DOCKET_EMAIL,
    documentReminders: documentReminders.success ? documentReminders.data : DEFAULT_DOCUMENT_REMINDERS,
  };
}
