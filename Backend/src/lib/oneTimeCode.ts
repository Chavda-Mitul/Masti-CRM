import { createHash, randomInt, timingSafeEqual } from "node:crypto";

// The client's one-time code on WhatsApp (message 16): the delivery boy asks for it at the client's door
// (docs/decisions/0015-field-staff-app.md Decision 4), and the desk at the office handover
// (docs/decisions/0014-visa-delivered.md Decision 2, amended 23 Oct 2026). Only a hash of it is kept. Its rules are the
// `field` setting's ⚠️ (fieldJobs/fieldJobs.settings.ts), one for both: Meta fixes the message's minutes.

/** How long a code works, the wrong tries it takes, and the wait before another can be sent. */
export interface CodeRules {
  otpMinutes: number;
  otpTries: number;
  otpResendSeconds: number;
}

/** A new code: six digits. */
export const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

/** Only a hash of the code is kept: sha256 of what it's for (a field job's id, or the handover's scope) and the code. */
export const codeHash = (scope: string, code: string) => createHash("sha256").update(`${scope}:${code}`).digest("hex");
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** "+91••••••1299": enough for the client to know which phone, not the whole number. */
export const maskMobile = (mobile: string) => (mobile.length > 7 ? `${mobile.slice(0, 3)}${"•".repeat(mobile.length - 7)}${mobile.slice(-4)}` : "•••");

/** Until when a code sent at `sentAt` works. */
export const codeExpiresAt = (sentAt: Date, rules: CodeRules) => new Date(sentAt.getTime() + rules.otpMinutes * 60_000);

/** When another may be sent after one went at `sentAt`. */
export const codeResendAt = (sentAt: Date, rules: CodeRules) => new Date(sentAt.getTime() + rules.otpResendSeconds * 1000);

/** Why another code can't be sent yet, or null: none went yet, or the wait is over. */
export function resendRefusal(sentAt: Date | null, rules: CodeRules, now: Date) {
  if (!sentAt) return null;
  const wait = codeResendAt(sentAt, rules).getTime() - now.getTime();
  return wait > 0 ? `Wait ${Math.ceil(wait / 1000)} seconds, then send a new code.` : null;
}

/** What the code the client read out comes to: right; refused, with why; or wrong, with the tries used and why. */
export type CodeCheck = { result: "right" } | { result: "refused"; message: string } | { result: "wrong"; tries: number; left: number; message: string };

/**
 * The code the client reads out, against the one sent (`scope`, as it was hashed): refused once it has expired or after
 * the rules' wrong tries, until a new one is sent. A wrong one is the caller's to count and audit.
 */
export function checkCode(sent: { hash: string; expiresAt: Date; tries: number }, scope: string, code: string, rules: CodeRules, now: Date): CodeCheck {
  if (sent.expiresAt <= now) return { result: "refused", message: "This code has expired. Send a new one." };
  if (sent.tries >= rules.otpTries) return { result: "refused", message: "Too many wrong tries. Send a new code." };
  if (sameHash(sent.hash, codeHash(scope, code))) return { result: "right" };
  const tries = sent.tries + 1;
  const left = rules.otpTries - tries;
  const message = left > 0 ? `That's not the code. ${left} ${left === 1 ? "try" : "tries"} left.` : "That's not the code, and that was the last try. Send a new code.";
  return { result: "wrong", tries, left, message };
}
