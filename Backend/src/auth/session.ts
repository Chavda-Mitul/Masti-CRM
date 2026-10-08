import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { env, isProduction } from "../config/env";
import { prisma } from "../config/prisma";
import { withDepartments } from "./user";

export const SESSION_COOKIE = "masti_sid";

const HOUR = 60 * 60 * 1000;
const TOUCH_EVERY_MS = 5 * 60 * 1000;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Idle expiry, capped by the absolute maximum session age. */
function nextExpiry(createdAt: Date, now = new Date()): Date {
  const idle = now.getTime() + env.SESSION_IDLE_HOURS * HOUR;
  const absolute = createdAt.getTime() + env.SESSION_MAX_DAYS * 24 * HOUR;
  return new Date(Math.min(idle, absolute));
}

export async function createSession(userId: string, req: Request) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const session = await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: nextExpiry(now, now),
      ip: req.ip ?? null,
      userAgent: req.get("user-agent")?.slice(0, 500) ?? null,
    },
  });
  return { token, session };
}

/** The session for a cookie token, with its user. Expired sessions are deleted and treated as missing. */
export async function findSession(token: string) {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: withDepartments } },
  });
  if (!session) return null;
  if (session.expiresAt <= new Date()) {
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

export async function revokeSession(sessionId: string) {
  await prisma.session.deleteMany({ where: { id: sessionId } });
}

/** Ends every session for a user (deactivation, password reset), optionally keeping the current one. */
export async function revokeUserSessions(userId: string, exceptSessionId?: string) {
  await prisma.session.deleteMany({
    where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
  });
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: isProduction, sameSite: "lax", path: "/" });
}
