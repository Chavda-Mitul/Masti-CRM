import { z } from "zod";
import { NoticeCategory, NoticeSource } from "../../../generated/prisma/enums";

// The notice board (docs/decisions/0017-today-dashboard.md Decision 11). Only zod and the generated enums are imported
// here, so these schemas can later be shared with the frontend.

/** A notice is a short message, not a document. */
export const MAX_NOTICE_ABOUT = 60;
export const MAX_NOTICE_TITLE = 120;
export const MAX_NOTICE_BODY = 1000;

const departmentCode = z.string().trim().toUpperCase().regex(/^[A-Z_]{2,30}$/, "Pick a department.");
const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optionalText = (max: number) => z.preprocess(blankToNull, z.string().trim().max(max).nullable()).optional();
const title = z.string().trim().min(1, "Give the notice a title.").max(MAX_NOTICE_TITLE);

/** The board: every department's notices, newest first. A department tab and a category pill narrow it. */
export const listNoticesQuerySchema = z.object({
  department: departmentCode.optional(),
  category: z.enum(NoticeCategory).optional(),
  cursor: z.string().max(400).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const createNoticeSchema = z.object({
  departmentCode,
  category: z.enum(NoticeCategory),
  /** Which airline, embassy or hotel, or a word for a general one ("Process"). */
  about: optionalText(MAX_NOTICE_ABOUT),
  title,
  body: optionalText(MAX_NOTICE_BODY),
  source: z.enum(NoticeSource).default("TEAM"),
  /** In the visa team's login popup (Decision 12): Visa notices, picked by the Head or the Visa HOD. */
  loginPopup: z.boolean().default(false),
});

/** A notice stays in its department; the rest can change. updatedAt: the version the form opened on. */
export const updateNoticeSchema = z.object({
  category: z.enum(NoticeCategory).optional(),
  about: optionalText(MAX_NOTICE_ABOUT),
  title: title.optional(),
  body: optionalText(MAX_NOTICE_BODY),
  source: z.enum(NoticeSource).optional(),
  /** Sent unchanged by the form, so its author can edit a picked notice's text. */
  loginPopup: z.boolean().optional(),
  updatedAt: z.iso.datetime("Reload and try again."),
});

/** "Got it" on the visa team's login popup: seen up to the newest item shown, and which items (for the audit). */
export const loginPopupSeenSchema = z.object({
  upTo: z.iso.datetime(),
  noticeIds: z.array(z.string().min(1).max(64)).max(50).default([]),
  holidayIds: z.array(z.string().min(1).max(64)).max(50).default([]),
});

export type ListNoticesQuery = z.infer<typeof listNoticesQuerySchema>;
export type CreateNoticeInput = z.infer<typeof createNoticeSchema>;
export type UpdateNoticeInput = z.infer<typeof updateNoticeSchema>;
export type LoginPopupSeenInput = z.infer<typeof loginPopupSeenSchema>;
