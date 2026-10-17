import { Router } from "express";
import { currentUser, requireAuth, requirePasswordChanged, requireUserType } from "../../middleware/auth";
import { myRunQuerySchema } from "./field.schemas";
import { listMyJobs } from "./fieldJobs.service";

/**
 * The collection and delivery boy's own screen (docs/decisions/0015-field-staff-app.md; docs/decisions/0002-user-types.md:
 * field staff reach only /api/auth/* and their own jobs). Office staff and the Head use the case pages instead.
 */
const router = Router();
router.use(requireAuth, requirePasswordChanged, requireUserType("FIELD"));

/** His run for a day (phase 3; today when none is asked for): his stops in slot order, with what each needs. */
router.get("/jobs", async (req, res) => {
  const { day } = myRunQuerySchema.parse(req.query);
  res.json(await listMyJobs(currentUser(req).id, day));
});

export default router;
