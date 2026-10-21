import { Router } from "express";
import { actorOf, requireAuth, requireDepartment, requirePasswordChanged, requireUserType } from "../../middleware/auth";
import { addConsentWordingSchema } from "./consent.schemas";
import * as consentService from "./consent.service";

/**
 * The consent form's wording in Settings (docs/decisions/0022-consent-form.md, part 2b), under /api/masters. Visa VIEW
 * to read, Visa EDIT to add a version; the service then requires the Visa HOD (or the Head), as for covering letters.
 */
const router = Router();
router.use(requireAuth, requirePasswordChanged, requireUserType("HEAD", "OFFICE"));

router.get("/consent-wording", requireDepartment("VISA", "VIEW"), async (_req, res) => {
  res.json({ versions: await consentService.listConsentWordings() });
});

router.post("/consent-wording", requireDepartment("VISA", "EDIT"), async (req, res) => {
  const body = addConsentWordingSchema.parse(req.body);
  res.status(201).json({ versions: await consentService.addConsentWording(body, actorOf(req)) });
});

export default router;
