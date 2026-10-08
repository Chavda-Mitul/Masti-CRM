import { createHash, randomBytes } from "node:crypto";
import type { Response } from "express";
import { cookieSecure, env } from "../../config/env";
import { prisma, type Db } from "../../config/prisma";
import { withDepartments } from "../users/user";

export const SESSION_COOKIE = "masti_sid";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const TOUCH_EVERY_MS = 5 * 60 * 1000;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Idle expiry, capped by the absolute maximum session age. */
function nextExpiry(createdAt: Date, now = new Date()): Date {
  const idle = now.getTime() + env.SESSION_IDLE_HOURS * HOUR;
  const absolute = createdAt.getTime() + env.SESSION_MAX_DAYS * 24 * HOUR;
  return new Date(Math.min(idle, absolute));
}

/** Where a login came from, recorded on the session. */
export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
}

export async function createSession(userId: string, client: ClientInfo, db: Db = prisma) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const session = await db.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: nextExpiry(now, now),
      ip: client.ip,
      userAgent: client.userAgent?.slice(0, 500) ?? null,
    },
  });
  return { token, session };
}

/**
 * The session for a cookie token, with its user. Expired sessions are deleted and treated as missing.
 *
 * While the user still has a temporary password, the session only lasts TEMP_PASSWORD_SESSION_MINUTES.
 * Such a session was opened by typing the temporary password (a reset ends every session), so the
 * forced password change can skip asking for it again without leaving a long-lived bypass.
 */
export async function findSession(token: string) {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: withDepartments } },
  });
  if (!session) return null;
  const now = new Date();
  const tempPasswordExpired =
    session.user.mustChangePassword &&
    session.createdAt.getTime() + env.TEMP_PASSWORD_SESSION_MINUTES * MINUTE <= now.getTime();
  if (session.expiresAt <= now || tempPasswordExpired) {
    await prisma.session.deleteMany({ where: { id: session.id } });
    return null;
  }
  return session;
}

/** Sliding expiry. Writes at most once every 5 minutes per session. Returns the (possibly new) expiry. */
export async function touchSession(session: { id: string; createdAt: Date; lastSeenAt: Date; expiresAt: Date }) {
  const now = new Date();
  if (now.getTime() - session.lastSeenAt.getTime() < TOUCH_EVERY_MS) return session.expiresAt;
  const expiresAt = nextExpiry(session.createdAt, now);
  await prisma.session.updateMany({ where: { id: session.id }, data: { lastSeenAt: now, expiresAt } });
  return expiresAt;
}

/** Deletes sessions past their expiry. Expired ones are refused anyway; this only keeps the table small. */
export async function deleteExpiredSessions() {
  const { count } = await prisma.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  return count;
}

export async function revokeSession(sessionId: string) {
  await prisma.session.deleteMany({ where: { id: sessionId } });
}

/** Ends every session for a user (deactivation, password reset), optionally keeping the current one. */
export async function revokeUserSessions(userId: string, exceptSessionId?: string, db: Db = prisma) {
  await db.session.deleteMany({
    where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
  });
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: cookieSecure, sameSite: "lax", path: "/" });
}
