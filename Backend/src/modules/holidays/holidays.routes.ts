import { Router } from "express";
import { actorOf, requireAuth, requireHead, requirePasswordChanged, requireUserType } from "../../middleware/auth";
import {
  blockedQuerySchema,
  createHolidaySchema,
  listHolidaysQuerySchema,
  updateHolidaySchema,
  updateHolidaySettingsSchema,
} from "./holidays.schemas";
import * as holidaysService from "./holidays.service";

/**
 * The holiday calendar (docs/decisions/0005-system-masters.md). Every department may need it, so there is no
 * department check: the Head and office staff read it; the service lets the Head or any HOD change it.
 * Field staff get nothing here.
 */
const router = Router();
router.use(requireAuth, requirePasswordChanged, requireUserType("HEAD", "OFFICE"));

// Fixed paths first, so they aren't taken for a holiday id.

router.get("/blocked", async (req, res) => {
  res.json(await holidaysService.listBlockedDays(blockedQuerySchema.parse(req.query)));
});

router.get("/targets", async (_req, res) => {
  res.json(await holidaysService.getTargetOptions());
});

router.get("/settings", async (_req, res) => {
  res.json({ settings: await holidaysService.getSettings() });
});

router.put("/settings", requireHead, async (req, res) => {
  const body = updateHolidaySettingsSchema.parse(req.body);
  res.json({ settings: await holidaysService.updateSettings(body, actorOf(req)) });
});

router.get("/", async (req, res) => {
  res.json({ holidays: await holidaysService.listHolidays(listHolidaysQuerySchema.parse(req.query)) });
});

router.post("/", async (req, res) => {
  const body = createHolidaySchema.parse(req.body);
  res.status(201).json({ holiday: await holidaysService.createHoliday(body, actorOf(req)) });
});

router.patch("/:id", async (req, res) => {
  const body = updateHolidaySchema.parse(req.body);
  res.json({ holiday: await holidaysService.updateHoliday(req.params.id, body, actorOf(req)) });
});

router.post("/:id/remove", async (req, res) => {
  res.json({ holiday: await holidaysService.removeHoliday(req.params.id, actorOf(req)) });
});

export default router;
