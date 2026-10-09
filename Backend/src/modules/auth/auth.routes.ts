import { Router } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { currentUser, requireAuth } from "../../middleware/auth";
import { toUserDto } from "../users/user";
import { changePasswordSchema, loginSchema } from "./auth.schemas";
import { parseIdentifier } from "./identifier";
import * as authService from "./auth.service";
import { clearSessionCookie, SESSION_COOKIE, setSessionCookie } from "./session";

const router = Router();

/**
 * The account a login is for, as the limiter's key: "98250 41234", "+91 98250 41234" and "09825041234" are one account,
 * so writing the number differently doesn't buy more tries. Text that isn't a mobile or email is keyed as typed.
 */
function loginKey(input: unknown): string {
  if (typeof input !== "string") return "";
  const parsed = parseIdentifier(input);
  if (!parsed) return input.trim().toLowerCase();
  return parsed.kind === "email" ? parsed.email : parsed.mobile;
}

/** 10 failed attempts per 15 minutes for the same IP + account. Successful logins don't count. */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip ?? "unknown")}|${loginKey(req.body?.identifier)}`,
  handler: (_req, res) => {
    res.status(429).json({ message: "Too many login attempts. Please wait 15 minutes and try again." });
  },
});

/**
 * 50 failed attempts per 15 minutes from one IP, whatever the identifier. Stops someone cycling through
 * made-up identifiers to dodge the limit above (each failure is a permanent audit row).
 * Generous because the whole office may share one IP.
 */
const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 50,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown"),
  handler: (_req, res) => {
    res.status(429).json({ message: "Too many login attempts. Please wait 15 minutes and try again." });
  },
});

router.post("/login", loginIpLimiter, loginLimiter, async (req, res) => {
  const body = loginSchema.parse(req.body);
  const { user, token, expiresAt } = await authService.login(body, {
    ip: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
  });
  setSessionCookie(res, token, expiresAt);
  res.json({ user });
});

router.post("/logout", async (req, res) => {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof token === "string" && token) await authService.logout(token, req.ip ?? null);
  clearSessionCookie(res);
  res.status(204).end();
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: toUserDto(currentUser(req)) });
});

router.post("/change-password", requireAuth, async (req, res) => {
  const body = changePasswordSchema.parse(req.body);
  const user = await authService.changePassword(currentUser(req), req.auth?.sessionId, body, req.ip ?? null);
  res.json({ user });
});

export default router;
