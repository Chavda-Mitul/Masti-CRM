import { Router } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { consentAgreeSchema, consentViewSchema } from "./consent.schemas";
import { agreeConsent, viewConsent } from "./consent.public.service";

/**
 * The client's consent page (docs/decisions/0022-consent-form.md, part 2), opened from WhatsApp: no login, and so no
 * office-network rule. The token is the key, sent in the body (never the path) so no log holds it. Limited per IP, as
 * login is.
 */
const router = Router();

router.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown"),
    handler: (_req, res) => {
      res.status(429).json({ message: "Too many tries. Please wait 15 minutes and open the link again." });
    },
  }),
);

router.post("/view", async (req, res) => {
  const { token } = consentViewSchema.parse(req.body);
  res.json({ consent: await viewConsent(token) });
});

router.post("/agree", async (req, res) => {
  const { token, ...shown } = consentAgreeSchema.parse(req.body);
  res.json({ consent: await agreeConsent(token, shown, { ip: req.ip ?? null, userAgent: req.get("user-agent") ?? null }) });
});

export default router;
