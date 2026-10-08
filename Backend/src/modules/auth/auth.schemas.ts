import { z } from "zod";
import { UserType } from "../../../generated/prisma/enums";

// Only zod and the generated enums are imported here, so these schemas can later be shared with the frontend.

export const MIN_PASSWORD_LENGTH = 8;

export const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(200),
});

export const changePasswordSchema = z.object({
  /** Required, except for the forced change after logging in with a temporary password. */
  currentPassword: z.string().min(1).max(200).optional(),
  newPassword: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
    .max(200),
});

/** The "officeNetwork" Setting row. See officeNetwork.ts. */
export const officeNetworkSchema = z.object({
  enabled: z.boolean(),
  /** IPs or CIDR ranges, IPv4 or IPv6, e.g. "203.0.113.10" or "203.0.113.0/24". */
  allow: z.array(z.string()),
  exemptUserTypes: z.array(z.enum(UserType)),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type OfficeNetworkSetting = z.infer<typeof officeNetworkSchema>;
