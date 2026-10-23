import { z } from "zod";

// Portal logins, "Log in for me" (docs/decisions/0024-portal-logins.md). Only zod is imported here, so the frontend keeps
// a copy (Frontend/src/pages/settings/portals/schemas.ts); tests/frontendRules.test.ts checks the two agree.

export const MAX_PORTAL_NAME = 80;
export const MAX_PORTAL_URL = 500;
export const MAX_ID_LABEL = 30;
export const MAX_LOGIN_ID = 200;
export const MAX_PORTAL_PASSWORD = 200;
export const MAX_PORTAL_PEOPLE = 100;

/**
 * What the CRM helper may report after a press. REFUSED isn't here: only the server sets it. Matches the Prisma enum
 * PortalLoginOutcome (tests/frontendRules.test.ts checks it, and the Helper's and the Frontend's lists).
 */
export const HELPER_OUTCOMES = ["SUBMITTED", "WAITING_FOR_STAFF", "NO_LOGIN_BOXES", "ADDRESS_CHANGED", "DIDNT_OPEN", "FAILED"] as const;

/**
 * How often a portal's password has to change (component 2); overdue, the portal locks. Matches the Prisma enum
 * PortalPasswordSchedule (tests/frontendRules.test.ts checks it, and the Frontend's list).
 */
export const PASSWORD_SCHEDULES = ["DAILY", "WEEKLY", "MONTHLY", "NONE"] as const;

/**
 * Why a login page address can't be saved, or null if it can: https, or http (some suppliers' portals have no https),
 * and never an ID or password inside the address.
 */
export function loginUrlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return "Paste the portal's login page address, starting with https://";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "The address must start with https:// or http://";
  if (url.username || url.password) return "Take the ID and password out of the address: they go in their own boxes.";
  if (/\s/.test(url.href) || url.href.length > MAX_PORTAL_URL) return `Use an address of at most ${MAX_PORTAL_URL} characters.`;
  return null;
}

const departmentCode = z.string().trim().toUpperCase().regex(/^[A-Z_]{2,30}$/, "Pick a department.");
const name = z.string().trim().min(1, "Give the portal a name.").max(MAX_PORTAL_NAME);
/** Saved as the browser would read it ("https://Example.com" → "https://example.com/"). */
const loginUrl = z
  .string()
  .trim()
  .min(1, "Paste the portal's login page address.")
  .max(MAX_PORTAL_URL)
  .transform((raw, ctx) => {
    const problem = loginUrlProblem(raw);
    if (problem) {
      ctx.addIssue({ code: "custom", message: problem });
      return z.NEVER;
    }
    return new URL(raw).href;
  });
const idLabel = z.string().trim().min(1, "Say what the portal calls the first box, e.g. ID.").max(MAX_ID_LABEL);
/** The ID loses stray spaces at its ends; the password is kept exactly as typed. */
const loginId = z.string().trim().min(1, "Type the portal's ID.").max(MAX_LOGIN_ID);
const password = z.string().min(1, "Type the portal's password.").max(MAX_PORTAL_PASSWORD);
const userIds = z.array(z.string().min(1).max(64)).max(MAX_PORTAL_PEOPLE);
const passwordSchedule = z.enum(PASSWORD_SCHEDULES, "Pick how often the password changes.");
/** A third login box's name (e.g. "Agency code"), for portals that have one before the ID and password. */
const extraLabel = z.string().trim().max(MAX_ID_LABEL);
/** That box's value. */
const extra = z.string().min(1, "Type the value for the extra box.").max(MAX_LOGIN_ID);

export const createPortalLoginSchema = z
  .object({
    departmentCode,
    name,
    loginUrl,
    idLabel: idLabel.default("ID"),
    loginId,
    password,
    /** A third login box before the ID and password; leave both out for an ordinary two-box login. */
    extraLabel: extraLabel.min(1, "Say what the extra box is called.").optional(),
    extra: extra.optional(),
    /** Masti changes them monthly. */
    passwordSchedule: passwordSchedule.default("MONTHLY"),
    /** Who may use it, besides the Head and the department's HOD. */
    userIds: userIds.default([]),
  })
  .refine((v) => (v.extraLabel === undefined) === (v.extra === undefined), {
    message: "Give both the extra box's name and its value, or neither.",
    path: ["extra"],
  });

/**
 * The department stays. The ID, password and the extra box's value change only when sent; left out, they're kept.
 * `extraLabel: ""` removes the extra box. updatedAt: the version the form opened on.
 */
export const updatePortalLoginSchema = z.object({
  name: name.optional(),
  loginUrl: loginUrl.optional(),
  idLabel: idLabel.optional(),
  loginId: loginId.optional(),
  password: password.optional(),
  extraLabel: extraLabel.optional(),
  extra: extra.optional(),
  passwordSchedule: passwordSchedule.optional(),
  userIds: userIds.optional(),
  updatedAt: z.iso.datetime("Reload and try again."),
});

/** The people an HOD can put on a portal's list: the department's office staff. */
export const peopleQuerySchema = z.object({ department: departmentCode });

/** What the CRM helper said happened after a press. */
export const outcomeSchema = z.object({ outcome: z.enum(HELPER_OUTCOMES) });

/** The CRM helper collects a login with the one-time ticket: 32 random bytes, base64url. */
export const redeemSchema = z.object({ ticket: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Not a ticket.") });

export type CreatePortalLoginInput = z.infer<typeof createPortalLoginSchema>;
export type UpdatePortalLoginInput = z.infer<typeof updatePortalLoginSchema>;
export type OutcomeInput = z.infer<typeof outcomeSchema>;
export type RedeemInput = z.infer<typeof redeemSchema>;
