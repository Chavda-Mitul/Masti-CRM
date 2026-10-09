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
