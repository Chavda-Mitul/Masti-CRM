import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../../config/env";

// A file sent with a WhatsApp message (docs/decisions/0025-evisa-after-decision.md, part 2). The provider fetches it
// through the CRM's own link, …/api/public/message-files/<message id>/<file name>?key=<key>, which answers both GET
// and HEAD (Twilio checks a file's link with both; an S3 pre-signed link answers only one). The key is 32 random bytes,
// made afresh at each try; only its SHA-256 is kept, with when the link stops working. It goes in the query string,
// which the request log never keeps (lib/logger.ts). The path ends in the file's name, which is what WhatsApp shows:
// Twilio can't set a document's name.

/** How long a file link works ⚠️: the provider fetches the file while it sends the message, within seconds. */
export const FILE_LINK_MINUTES = 30;

export const hashFileKey = (key: string) => createHash("sha256").update(key).digest("hex");

/** A new key for a message's file: its hash and when it stops working, to store, and the link the provider fetches. */
export function newFileLink(messageId: string, fileName: string, now = new Date()) {
  const key = randomBytes(32).toString("base64url");
  const base = env.PUBLIC_APP_URL.replace(/\/+$/, "");
  return {
    keyHash: hashFileKey(key),
    expiresAt: new Date(now.getTime() + FILE_LINK_MINUTES * 60_000),
    url: `${base}/api/public/message-files/${messageId}/${encodeURIComponent(fileName)}?key=${key}`,
  };
}

/** Whether `key` is the one whose hash was kept, compared in constant time. */
export function keyMatches(key: string, keyHash: string): boolean {
  const given = Buffer.from(hashFileKey(key), "hex");
  const kept = Buffer.from(keyHash, "hex");
  return given.length === kept.length && timingSafeEqual(given, kept);
}

/** The file's type, from its name: the provider refuses a file whose stated type isn't what it is. */
export function contentTypeOf(fileName: string): string {
  const extension = fileName.toLowerCase().split(".").at(-1);
  switch (extension) {
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}
