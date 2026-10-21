// What the CRM page and the helper say to each other (docs/decisions/0024-portal-logins.md). The page sends
// chrome.runtime.sendMessage(helperId, message); the helper answers with one of the responses below.

/**
 * Every outcome a press can end in. Matches the Prisma enum PortalLoginOutcome and the Frontend's copy
 * (Backend/tests/frontendRules.test.ts checks all three).
 */
export const OUTCOMES = ["SUBMITTED", "WAITING_FOR_STAFF", "NO_LOGIN_BOXES", "ADDRESS_CHANGED", "DIDNT_OPEN", "REFUSED", "FAILED"] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** A ticket from POST /api/portal-logins/:id/open: 32 random bytes, base64url. */
export const TICKET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** "Are you there?" The page asks before showing Log in for me as ready. */
export interface PingMessage {
  type: "ping";
}

/** "Log in with this ticket." */
export interface LoginMessage {
  type: "login";
  ticket: string;
}

export interface PingResponse {
  ok: true;
  version: string;
}

/** message: the server's own words when it refused. */
export interface LoginResponse {
  outcome: Outcome;
  message?: string;
}
