import { Router } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { currentApiClient, requireApiClient } from "../../middleware/apiClient";
import { botListQuerySchema } from "../holidays/holidays.schemas";
import * as holidaysBot from "../holidays/holidaysBot.service";

/**
 * Machine-to-machine routes (docs/decisions/0005-system-masters.md §5): an API key, never a session cookie.
 * Later: /whatsapp and /website for enquiries (0003).
 */
const router = Router();

/** Per IP, before the key check, so guessing keys is slow too. A bot pushes a few times a day. */
router.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? "unknown"),
    handler: (_req, res) => {
      res.status(429).json({ message: "Too many requests. Wait 15 minutes and try again." });
    },
  }),
);

const holidays = Router();
holidays.use(requireApiClient("HOLIDAYS_PUSH"));

holidays.get("/targets", async (_req, res) => {
  res.json(await holidaysBot.getBotTargets());
});

holidays.get("/", async (req, res) => {
  const { updatedSince } = botListQuerySchema.parse(req.query);
  res.json({ holidays: await holidaysBot.listBotHolidays(currentApiClient(req), updatedSince) });
});

holidays.post("/", async (req, res) => {
  res.json(await holidaysBot.pushBotHolidays(req.body, currentApiClient(req), req.ip ?? null));
});

router.use("/holidays", holidays);

export default router;
