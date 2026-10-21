import { createCipheriv, createDecipheriv, createSecretKey, randomBytes } from "node:crypto";
import { env } from "../config/env";

// Locks a small secret (a portal's ID and password) with AES-256-GCM under PORTAL_VAULT_KEY, which lives outside the
// database (PROJECT_KNOWLEDGE §16.5, docs/decisions/0024-portal-logins.md). A sealed blob is: a version byte, the 12-byte
// IV, the 16-byte tag, then the ciphertext. The caller's label (e.g. "portal-login:<id>") is bound in as associated
// data, so a blob copied onto another row won't open there.

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + IV_BYTES + TAG_BYTES;

/** PORTAL_VAULT_KEY isn't set on this server. */
export class VaultKeyMissingError extends Error {
  constructor() {
    super("PORTAL_VAULT_KEY is not set.");
  }
}

/** The blob was changed, belongs to another row, or was sealed with another key. */
export class SecretUnreadableError extends Error {
  constructor() {
    super("The secret can't be opened with this key.");
  }
}

/** Whether secrets can be sealed and opened on this server. */
export function vaultReady(key: Buffer | null = env.PORTAL_VAULT_KEY ?? null): boolean {
  return key !== null;
}

function keyObject(key: Buffer | null) {
  if (!key) throw new VaultKeyMissingError();
  return createSecretKey(key);
}

/** Seals a JSON-safe value. Sealing the same value twice gives different blobs. */
export function sealSecret(value: unknown, label: string, key: Buffer | null = env.PORTAL_VAULT_KEY ?? null): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyObject(key), iv);
  cipher.setAAD(Buffer.from(label, "utf8"));
  const text = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), text]);
}

/** Opens a blob from sealSecret with the same label. Throws SecretUnreadableError if it can't. */
export function openSecret<T>(blob: Uint8Array, label: string, key: Buffer | null = env.PORTAL_VAULT_KEY ?? null): T {
  const k = keyObject(key);
  const bytes = Buffer.from(blob);
  if (bytes.length <= HEADER_BYTES || bytes[0] !== VERSION) throw new SecretUnreadableError();
  try {
    const decipher = createDecipheriv("aes-256-gcm", k, bytes.subarray(1, 1 + IV_BYTES));
    decipher.setAAD(Buffer.from(label, "utf8"));
    decipher.setAuthTag(bytes.subarray(1 + IV_BYTES, HEADER_BYTES));
    const text = Buffer.concat([decipher.update(bytes.subarray(HEADER_BYTES)), decipher.final()]);
    return JSON.parse(text.toString("utf8")) as T;
  } catch {
    throw new SecretUnreadableError();
  }
}
