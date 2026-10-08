import { z } from "zod";
import { ApiScope } from "../../../generated/prisma/enums";

// Only zod and the generated enums are imported here, so these schemas can later be shared with the frontend.
// IP entries are checked in the service (it needs node:net).

const name = z.string().trim().min(1, "Give it a name, e.g. Holiday bot.").max(80);
const scopes = z
  .array(z.enum(ApiScope))
  .min(1, "Pick at least one permission.")
  .max(10)
  .transform((list) => [...new Set(list)]);
/** Single IPs or CIDR ranges. Empty = any address. */
const allowedIps = z.array(z.string().trim().min(1).max(50)).max(20);

export const createApiClientSchema = z.object({
  name,
  scopes,
  allowedIps: allowedIps.default([]),
});

export const updateApiClientSchema = z.object({
  name: name.optional(),
  scopes: scopes.optional(),
  allowedIps: allowedIps.optional(),
});

export type CreateApiClientInput = z.infer<typeof createApiClientSchema>;
export type UpdateApiClientInput = z.infer<typeof updateApiClientSchema>;
