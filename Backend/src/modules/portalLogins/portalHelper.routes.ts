import { Router, type Request } from "express";
import { ipKeyGenerator, MemoryStore, rateLimit } from "express-rate-limit";
import { env } from "../../config/env";
import { forbidden } from "../../lib/httpError";
import { redeemSchema } from "./portalLogins.schemas";
import * as portalHelperService from "./portalHelper.service";

/**
 * The one route with no session (docs/decisions/0024-portal-logins.md): the CRM helper, a Chrome extension, collects a
 * portal's ID and password with the one-time ticket the page gave it. Only the helper may ask: the browser sets the
 * Origin header to chrome-extension://<its id>, and no web page can fake that.
 */
const router = Router();

/** Where the limit below keeps its counts. Exported so tests can start each case afresh (resetAll). */
export const redeemLimitStore = new MemoryStore();

/** 20 failed collections per 15 minutes from one address. Successful ones don't count. */
const redeemLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  store: redeemLimitStore,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown"),
  handler: (_req, res) => {
    res.status(429).json({ message: "Too many tries. Please wait 15 minutes and press Log in for me again." });
  },
});

function assertFromHelper(req: Request) {
  const origin = req.get("origin");
  if (!origin || !env.PORTAL_HELPER_IDS.some((id) => origin === `chrome-extension://${id}`)) {
    throw forbidden("Only the CRM helper can collect a login.");
  }
}

router.post("/redeem", redeemLimiter, async (req, res) => {
  // The answer holds a password: nothing may keep it.
  res.set("Cache-Control", "no-store");
  assertFromHelper(req);
  const { ticket } = redeemSchema.parse(req.body);
  res.json(await portalHelperService.redeemTicket(ticket, req.ip));
});

export default router;
