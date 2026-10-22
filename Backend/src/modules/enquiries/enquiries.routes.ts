import { Router } from "express";
import { z } from "zod";
import { actorOf, currentUser, requireAuth, requirePasswordChanged, requireUserType } from "../../middleware/auth";
import {
  cancelSchema,
  followUpDeskQuerySchema,
  listEnquiriesQuerySchema,
  logFollowUpSchema,
  postponeSchema,
  reassignSchema,
  resumeSchema,
  unseenAssignmentsSeenSchema,
} from "./enquiries.schemas";
import * as enquiriesService from "./enquiries.service";
import * as actions from "./enquiryActions.service";
import { followUpBadge, followUpDesk } from "./followUpDesk.service";
import { markSeen, unseenCounts } from "./unseenAssignments.service";

/**
 * Enquiries across departments (docs/decisions/0003-visa-intake.md). No single department to check here:
 * the service shows only the departments the caller can view, and refuses a department they can't.
 */
const router = Router();
router.use(requireAuth, requirePasswordChanged, requireUserType("HEAD", "OFFICE"));

const caseNoParam = z.string().trim().min(1).max(40);

router.get("/", async (req, res) => {
  const query = listEnquiriesQuerySchema.parse(req.query);
  res.json(await enquiriesService.listEnquiries(query, currentUser(req)));
});

router.get("/sources", async (_req, res) => {
  res.json({ sources: await enquiriesService.listStaffSources() });
});

/** The follow-up desk: one bucket's rows and the four counts. */
router.get("/follow-ups", async (req, res) => {
  res.json(await followUpDesk(followUpDeskQuerySchema.parse(req.query), currentUser(req)));
});

/** The sidebar's red number: overdue follow-ups (mine, or my department's / everyone's for an HOD / the Head). */
router.get("/follow-ups/badge", async (req, res) => {
  res.json(await followUpBadge(currentUser(req)));
});

/** The sidebar's "To assign" count, for an HOD or the Head: open cases nobody owns yet. */
router.get("/to-assign", async (req, res) => {
  res.json(await enquiriesService.toAssignCount(currentUser(req)));
});

/** The sidebar's red dots: cases given to me that I haven't seen, per department (0006 amendment 22). */
router.get("/given-to-me", async (req, res) => {
  res.json(await unseenCounts(currentUser(req)));
});

/** Clicked a department in the sidebar: its dot goes. */
router.post("/given-to-me/seen", async (req, res) => {
  const body = unseenAssignmentsSeenSchema.parse(req.body);
  await markSeen(body.department, actorOf(req));
  res.status(204).end();
});

// Case actions (docs/decisions/0006-visa-documents.md Decision 6). The service checks who may act on the case.
router.post("/:caseNo/follow-ups", async (req, res) => {
  const body = logFollowUpSchema.parse(req.body);
  res.json(await actions.logFollowUp(caseNoParam.parse(req.params.caseNo), body, actorOf(req)));
});

router.post("/:caseNo/postpone", async (req, res) => {
  const body = postponeSchema.parse(req.body);
  res.json(await actions.postpone(caseNoParam.parse(req.params.caseNo), body, actorOf(req)));
});

router.post("/:caseNo/cancel", async (req, res) => {
  const body = cancelSchema.parse(req.body);
  res.json(await actions.cancel(caseNoParam.parse(req.params.caseNo), body, actorOf(req)));
});

router.post("/:caseNo/resume", async (req, res) => {
  const body = resumeSchema.parse(req.body);
  res.json(await actions.resume(caseNoParam.parse(req.params.caseNo), body, actorOf(req)));
});

/** The HOD or the Head gives the case to someone else. */
router.put("/:caseNo/owner", async (req, res) => {
  const body = reassignSchema.parse(req.body);
  res.json(await actions.reassign(caseNoParam.parse(req.params.caseNo), body, actorOf(req)));
});

/** Who the case can be given to (HOD or Head). */
router.get("/:caseNo/assignees", async (req, res) => {
  res.json({ assignees: await actions.listAssignees(caseNoParam.parse(req.params.caseNo), currentUser(req)) });
});

export default router;
