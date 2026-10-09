import { createHash, randomBytes } from "node:crypto";

// Machine account keys (docs/decisions/0005-system-masters.md §5): "mcrm_<8 hex>_<43 base64url>".
// The prefix is kept in clear for lookup and display; only a SHA-256 of the whole key is stored.
// The key carries 32 random bytes, so a fast hash is enough (as for session tokens).

const KEY_PATTERN = /^mcrm_([0-9a-f]{8})_([A-Za-z0-9_-]{43})$/;

export const hashApiKey = (key: string) => createHash("sha256").update(key).digest("hex");

export function generateApiKey() {
  const prefix = randomBytes(4).toString("hex");
  const key = `mcrm_${prefix}_${randomBytes(32).toString("base64url")}`;
  return { key, prefix, hash: hashApiKey(key) };
}

/** The key from an "Authorization: Bearer mcrm_…" header, or null if there is none or it isn't shaped like one. */
export function apiKeyFromHeader(header: string | undefined): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(header?.trim() ?? "");
  const key = match?.[1];
  return key && KEY_PATTERN.test(key) ? key : null;
}
