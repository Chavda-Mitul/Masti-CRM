import { Router } from "express";
import { currentUser, requireAuth, requirePasswordChanged, requireUserType } from "../../middleware/auth";
import { listEnquiriesQuerySchema } from "./enquiries.schemas";
import * as enquiriesService from "./enquiries.service";

/**
 * Enquiries across departments (docs/decisions/0003-visa-intake.md). No single department to check here:
 * the service shows only the departments the caller can view, and refuses a department they can't.
 */
const router = Router();
router.use(requireAuth, requirePasswordChanged, requireUserType("HEAD", "OFFICE"));

router.get("/", async (req, res) => {
  const query = listEnquiriesQuerySchema.parse(req.query);
  res.json(await enquiriesService.listEnquiries(query, currentUser(req)));
});

router.get("/sources", async (_req, res) => {
  res.json({ sources: await enquiriesService.listStaffSources() });
});

export default router;
