import { Router } from "express";
import { HttpError } from "../../lib/httpError";
import { readBody } from "../../lib/readBody";
import { actorOf, currentUser, requireAuth, requirePasswordChanged, requireUserType } from "../../middleware/auth";
import { checkOtpSchema, markDoneSchema, markFailedSchema, myRunQuerySchema } from "./field.schemas";
import { checkOtp, getMyStop, listFailReasons, listMyJobs, markDone, markFailed, selfieLimit, sendOtp, uploadSelfie } from "./fieldStops.service";

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

/** "Send the code" (Decision 4): a new one-time code to the client's email. */
router.post("/jobs/:jobId/otp", async (req, res) => {
  res.json(await sendOtp(req.params.jobId, actorOf(req)));
});

/** "Check" the code the client reads out. */
router.post("/jobs/:jobId/otp/check", async (req, res) => {
  const { code } = checkOtpSchema.parse(req.body);
  res.json(await checkOtp(req.params.jobId, code, actorOf(req)));
});

/**
 * His selfie at the door (Decision 4): the JPEG or PNG itself is the body, saved as soon as he takes it; "Picked up"
 * links it. The stop and the size limit are checked before the body is read.
 */
router.post("/jobs/:jobId/selfie", async (req, res) => {
  const type = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "image/jpeg" && type !== "image/png") throw new HttpError(415, "Send the selfie as a JPEG or PNG photo.");
  const actor = actorOf(req);
  const { maxBytes, tooBig } = await selfieLimit(req.params.jobId, actor);
  const bytes = await readBody(req, maxBytes, tooBig);
  res.json({ selfie: await uploadSelfie(req.params.jobId, bytes, type, actor) });
});

/** "Picked up" (Decision 4): the booklets he counted, his selfie and the place, once the client confirmed the code. */
router.post("/jobs/:jobId/done", async (req, res) => {
  const body = markDoneSchema.parse(req.body);
  res.json(await markDone(req.params.jobId, body, actorOf(req)));
});

export default router;
