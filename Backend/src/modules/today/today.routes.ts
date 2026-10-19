import { Router } from "express";
import { actorOf, currentUser, requireAuth, requireHead, requirePasswordChanged, requireUserType } from "../../middleware/auth";
import { updateTodaySettingsSchema } from "./today.schemas";
import * as todayService from "./today.service";

/**
 * The Today page (docs/decisions/0017-today-dashboard.md). It spans departments, so there is no department check: the
 * service counts only the departments the caller can view. Field staff have their run on /tasks instead.
 */
const router = Router();
router.use(requireAuth, requirePasswordChanged, requireUserType("HEAD", "OFFICE"));

/** One person's day: the banner's sentence and the tiles. */
router.get("/", async (req, res) => {
  res.json(await todayService.todaySummary(currentUser(req)));
});

router.get("/settings", async (_req, res) => {
  res.json({ settings: await todayService.getSettings() });
});

router.put("/settings", requireHead, async (req, res) => {
  const body = updateTodaySettingsSchema.parse(req.body);
  res.json({ settings: await todayService.updateSettings(body, actorOf(req)) });
});

export default router;
