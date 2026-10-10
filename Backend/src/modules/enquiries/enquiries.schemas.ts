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

export type PostponeInput = z.infer<typeof postponeSchema>;
export type CancelInput = z.infer<typeof cancelSchema>;
export type ResumeInput = z.infer<typeof resumeSchema>;
export type ReassignInput = z.infer<typeof reassignSchema>;
