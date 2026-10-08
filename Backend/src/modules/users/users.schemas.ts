import { z } from "zod";
import { UserType } from "../../../generated/prisma/enums";
import { MIN_PASSWORD_LENGTH } from "../auth/auth.schemas";

// Only zod and the generated enums are imported here, so these schemas can later be shared with the frontend.

export const membershipSchema = z.object({
  departmentCode: z.string().trim().min(1),
  role: z.enum(["STAFF", "HOD"]),
  access: z.enum(["VIEW", "EDIT"]),
});

export const createUserSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(100),
  mobile: z.string().trim().max(30).nullish(),
  email: z.string().trim().max(200).nullish(),
  type: z.enum(UserType).default("OFFICE"),
  departments: z.array(membershipSchema).default([]),
  /** Optional: if missing, a temporary password is generated and returned once. */
  password: z.string().min(MIN_PASSWORD_LENGTH).max(200).optional(),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(100).optional(),
  mobile: z.string().trim().max(30).nullish(),
  email: z.string().trim().max(200).nullish(),
  type: z.enum(UserType).optional(),
  departments: z.array(membershipSchema).optional(),
});

export type Membership = z.infer<typeof membershipSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
