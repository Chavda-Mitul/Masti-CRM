// PORTAL_VAULT_KEY and PORTAL_HELPER_IDS → the portal logins' settings (docs/decisions/0024-portal-logins.md).
// No side effects here, so they can be tested on their own.

/**
 * Parses PORTAL_VAULT_KEY, the key that locks every saved portal ID and password: 32 random bytes in base64, made with
 * `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
 */
export function parseVaultKey(raw: string): { value: Buffer } | { error: string } {
  const value = raw.trim();
  // Buffer.from skips characters that aren't base64, so check the text first.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return { error: "PORTAL_VAULT_KEY: not base64. Make one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"" };
  }
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) return { error: `PORTAL_VAULT_KEY: must be 32 bytes (44 base64 characters); this one is ${key.length}.` };
  return { value: key };
}

/**
 * Parses PORTAL_HELPER_IDS: the CRM helper's Chrome extension IDs, comma-separated. Only these may collect a login.
 * A Chrome extension ID is 32 letters from a to p.
 */
export function parseHelperIds(raw: string): { value: string[] } | { error: string } {
  const ids = raw.split(",").map((id) => id.trim()).filter(Boolean);
  const bad = ids.filter((id) => !/^[a-p]{32}$/.test(id));
  if (bad.length > 0) {
    return { error: `PORTAL_HELPER_IDS: not a Chrome extension ID (32 letters a–p): ${bad.map((id) => `"${id}"`).join(", ")}.` };
  }
  return { value: [...new Set(ids)] };
}
