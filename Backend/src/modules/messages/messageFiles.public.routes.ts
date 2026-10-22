import { Router } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { fetchMessageFile } from "./messageFiles.public.service";

/**
 * A WhatsApp message's file, fetched by the provider that sends it (docs/decisions/0025-evisa-after-decision.md, part
 * 2): no login, and so no office-network rule. The key in the query string is the permission; the request log keeps
 * only the path, never the query (lib/logger.ts). GET sends the file; HEAD, which Twilio asks first, the same headers
 * with no body. Limited per IP, as the consent page is.
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
      res.status(429).json({ message: "Too many tries. Please wait 15 minutes." });
    },
  }),
);

// The name in the path is only for show: WhatsApp names the document after it.
router.get("/:messageId/:fileName", async (req, res) => {
  const key = typeof req.query.key === "string" ? req.query.key : "";
  const withBytes = req.method !== "HEAD";
  const file = await fetchMessageFile(req.params.messageId, key, { withBytes, ip: req.ip ?? null });
  res.set({
    "Content-Type": file.contentType,
    "Content-Length": String(file.bytes?.length ?? file.sizeBytes),
    "Content-Disposition": `inline; filename="${file.fileName.replace(/["\\\r\n]/g, "")}"`,
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex",
  });
  res.end(file.bytes ?? undefined);
});

export default router;
