import { Router } from "express";
import { actorOf, currentUser, requireAuth, requirePasswordChanged, requireUserType } from "../../middleware/auth";
import { markFailedSchema, myRunQuerySchema } from "./field.schemas";
import { getMyStop, listFailReasons, listMyJobs, markFailed } from "./fieldStops.service";

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

/** One of his stops (phase 4), with today: he records a stop only on its day. Anyone else's is not found. */
router.get("/jobs/:jobId", async (req, res) => {
  res.json(await getMyStop(currentUser(req).id, req.params.jobId));
});

/** The reasons a visit fails (Decision 5), switched on: he can't read the office's lists under /api/masters. */
router.get("/fail-reasons", async (_req, res) => {
  res.json({ reasons: await listFailReasons() });
});

/** "Couldn't complete" (Decision 5): a reason and the place his phone gave. */
router.post("/jobs/:jobId/failed", async (req, res) => {
  const body = markFailedSchema.parse(req.body);
  res.json(await markFailed(req.params.jobId, body, actorOf(req)));
});

export default router;
