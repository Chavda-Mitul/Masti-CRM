import { z } from "zod";
import { EnquiryStatus } from "../../../generated/prisma/enums";

// Only zod and the generated enums are imported here, so these schemas can later be shared with the frontend.

/** The All enquiries list. Defaults: open enquiries in every department the caller can see. */
export const listEnquiriesQuerySchema = z.object({
  department: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z_]{2,30}$/)
    .optional(),
  status: z.enum(EnquiryStatus).default("OPEN"),
  mine: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  /** "To assign": nobody's yet, e.g. matured and waiting for the HOD to pick a processor. */
  unassigned: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  q: z.string().trim().max(100).optional(),
  /** Opaque: the nextCursor of the previous page. */
  cursor: z.string().max(400).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export type ListEnquiriesQuery = z.infer<typeof listEnquiriesQuerySchema>;

// ---------------------------------------------------------------------------
// Case actions (docs/decisions/0006-visa-documents.md Decision 6). Each sends the updatedAt the page loaded: a change by
// someone else in between is a 409 STALE.
// ---------------------------------------------------------------------------

const updatedAt = z.iso.datetime("Reload and try again.");
const reasonId = z.number().int().positive("Pick a reason.");

export const postponeSchema = z.object({
  reasonId,
  /** When it comes back, YYYY-MM-DD (IST). */
  resumeOn: z.iso.date("Pick the date it comes back."),
  updatedAt,
});

export const cancelSchema = z.object({ reasonId, updatedAt });

export const resumeSchema = z.object({ updatedAt });

export const reassignSchema = z.object({
  ownerId: z.uuid("Pick who takes it over."),
  updatedAt,
});

/** "Log call": What happened → Next step → When (a day and a time, IST). Both lists are masters (§7 rule 2). */
export const logFollowUpSchema = z.object({
  outcomeId: z.number().int().positive("Pick what happened."),
  nextStepId: z.number().int().positive("Pick the next step."),
  nextOn: z.iso.date("Pick the day."),
  at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick the time."),
  updatedAt,
});

// ---------------------------------------------------------------------------
// The follow-up desk (0006 Decision 9): Overdue · Today · This week · Postponed, mine or the whole department.
// ---------------------------------------------------------------------------

export const FOLLOW_UP_BUCKETS = ["OVERDUE", "TODAY", "WEEK", "POSTPONED"] as const;
export const FOLLOW_UP_SCOPES = ["MINE", "ALL"] as const;

export const followUpDeskQuerySchema = z.object({
  bucket: z.enum(FOLLOW_UP_BUCKETS).default("TODAY"),
  /** MINE: cases I own. ALL: every case I may see (the HOD's department, the Head's everything). */
  scope: z.enum(FOLLOW_UP_SCOPES).default("MINE"),
});

export type PostponeInput = z.infer<typeof postponeSchema>;
export type CancelInput = z.infer<typeof cancelSchema>;
export type ResumeInput = z.infer<typeof resumeSchema>;
export type ReassignInput = z.infer<typeof reassignSchema>;
export type LogFollowUpInput = z.infer<typeof logFollowUpSchema>;
export type FollowUpBucket = (typeof FOLLOW_UP_BUCKETS)[number];
export type FollowUpScope = (typeof FOLLOW_UP_SCOPES)[number];
export type FollowUpDeskQuery = z.infer<typeof followUpDeskQuerySchema>;
