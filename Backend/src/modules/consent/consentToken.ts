import { createHash, randomBytes } from "node:crypto";
import { env } from "../../config/env";

// The consent link's secret (docs/decisions/0022-consent-form.md, part 2). 32 random bytes, only its SHA-256 kept, as
// with session tokens. It goes after "#" in the link, which the browser never sends to a server, so no log ever holds
// it; the page sends it in the request body.

export const hashConsentToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** A new token, its hash to store, and the link the client opens. */
export function newConsentToken() {
  const token = randomBytes(32).toString("base64url");
  return { tokenHash: hashConsentToken(token), url: `${env.PUBLIC_APP_URL.replace(/\/+$/, "")}/consent#${token}` };
}

/** The link as staff see it on the "Sent to the client" card: the secret hidden, so nobody can agree for the client. */
export function maskConsentLinks(text: string): string {
  return text.replace(/\/consent#[A-Za-z0-9_-]+/g, "/consent#…");
}
