import { Router } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { parseIdentifier } from "../auth/identifier";
import { officeNetworkAllows } from "../auth/officeNetwork";
import { hashPassword, MIN_PASSWORD_LENGTH, verifyAgainstDummy, verifyPassword } from "../auth/password";
import {
  clearSessionCookie,
  createSession,
  findSession,
  revokeSession,
  revokeUserSessions,
  SESSION_COOKIE,
  setSessionCookie,
} from "../auth/session";
import { toUserDto, withDepartments } from "../auth/user";
import { audit } from "../lib/audit";
import { badRequest, forbidden, HttpError } from "../lib/httpError";
import { currentUser, requireAuth } from "../middleware/auth";

const router = Router();

const LOGIN_FAILED = "Wrong mobile number/email or password.";

const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(200),
});

/** 10 failed attempts per 15 minutes for the same IP + identifier. Successful logins don't count. */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => {
    const identifier = typeof req.body?.identifier === "string" ? req.body.identifier.trim().toLowerCase() : "";
    return `${ipKeyGenerator(req.ip ?? "unknown")}|${identifier}`;
  },
  handler: (_req, res) => {
    res.status(429).json({ message: "Too many login attempts. Please wait 15 minutes and try again." });
  },
});

router.post("/login", loginLimiter, async (req, res) => {
  const body = loginSchema.parse(req.body);
  const identifier = parseIdentifier(body.identifier);

  const user = identifier
    ? await prisma.user.findUnique({
        where: identifier.kind === "email" ? { email: identifier.email } : { mobile: identifier.mobile },
        include: withDepartments,
      })
    : null;

  // Always run a password check so response time doesn't reveal whether the account exists.
  const passwordOk = user ? await verifyPassword(user.passwordHash, body.password) : await verifyAgainstDummy(body.password);

  if (!user || !passwordOk || !user.isActive) {
    await audit({
      action: "auth.login.failed",
      entityType: "User",
      entityId: user?.id ?? null,
      after: {
        identifier: body.identifier.slice(0, 100),
        reason: !user ? "unknown_user" : !passwordOk ? "wrong_password" : "inactive_user",
      },
      ip: req.ip ?? null,
    });
    throw new HttpError(401, LOGIN_FAILED);
  }

  if (!(await officeNetworkAllows(user, req.ip))) {
    await audit({
      actorId: user.id,
      action: "auth.login.blocked_network",
      entityType: "User",
      entityId: user.id,
      ip: req.ip ?? null,
    });
    throw forbidden("The CRM can only be used from the office network.");
  }

  const { token, session } = await createSession(user.id, req);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
    include: withDepartments,
  });
  await audit({ actorId: user.id, action: "auth.login.success", entityType: "User", entityId: user.id, ip: req.ip ?? null });

  setSessionCookie(res, token, session.expiresAt);
  res.json({ user: toUserDto(updated) });
});

router.post("/logout", async (req, res) => {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof token === "string" && token) {
    const session = await findSession(token);
    if (session) {
      await revokeSession(session.id);
      await audit({
        actorId: session.userId,
        action: "auth.logout",
        entityType: "User",
        entityId: session.userId,
        ip: req.ip ?? null,
      });
    }
  }
  clearSessionCookie(res);
  res.status(204).end();
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: toUserDto(currentUser(req)) });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z
    .string()
    .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
    .max(200),
});

router.post("/change-password", requireAuth, async (req, res) => {
  const body = changePasswordSchema.parse(req.body);
  const user = currentUser(req);

  if (!(await verifyPassword(user.passwordHash, body.currentPassword))) {
    throw badRequest("Your current password is not correct.");
  }
  if (body.newPassword === body.currentPassword) {
    throw badRequest("Choose a new password that is different from the current one.");
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(body.newPassword), mustChangePassword: false },
    include: withDepartments,
  });
  // Sign out every other device; keep this one.
  await revokeUserSessions(user.id, req.auth?.sessionId);
  await audit({ actorId: user.id, action: "auth.password.change", entityType: "User", entityId: user.id, ip: req.ip ?? null });

  res.json({ user: toUserDto(updated) });
});

export default router;
