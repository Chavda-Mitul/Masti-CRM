import { Router } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { readBody } from "../../lib/readBody";
import { whatsAppWebhook } from "../../lib/whatsapp";
import { recordWhatsAppEvents } from "./whatsappWebhook.service";

/**
 * The WhatsApp provider's webhook (docs/decisions/0026-whatsapp-webhook.md): Meta reports here where our messages have
 * got to, and brings the clients' own. No login, and so no office-network rule: GET is the provider checking our
 * address with the verify token, and every POST must carry the provider's signature over the raw body, which is why
 * this router comes before the JSON parser (app.ts). The request log keeps the path only, never the query
 * (lib/logger.ts). Limited per IP, but well above what Meta sends.
 */
const router = Router();

/** Meta sends up to 1000 updates in one call. */
const MAX_BYTES = 5 * 1024 * 1024;

const NOT_SET_UP = "WhatsApp's webhook isn't set up.";

router.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 600,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown"),
    handler: (_req, res) => {
      res.status(429).json({ message: "Too many calls. Please wait a minute." });
    },
  }),
);

router.get("/", (req, res) => {
  const hook = whatsAppWebhook();
  if (!hook) {
    res.status(404).json({ message: NOT_SET_UP });
    return;
  }
  const challenge = hook.webhook.handshake(req.query as Record<string, unknown>);
  if (challenge === null) {
    res.status(403).json({ message: "That isn't the verify token." });
    return;
  }
  res.type("text/plain").send(challenge);
});

router.post("/", async (req, res) => {
  const hook = whatsAppWebhook();
  if (!hook) {
    res.status(404).json({ message: NOT_SET_UP });
    return;
  }
  const events = hook.webhook.events(await readBody(req, MAX_BYTES, "Too big for a webhook call."), req.headers);
  if (!events) {
    res.status(401).json({ message: "Not signed by the provider." });
    return;
  }
  await recordWhatsAppEvents(hook.provider, events);
  res.sendStatus(200);
});

export default router;
