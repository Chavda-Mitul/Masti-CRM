import { Router } from "express";
import { actorOf, requireAuth, requireHead, requirePasswordChanged, requireUserType } from "../../middleware/auth";
import { updateCompanyDetailsSchema } from "./company.schemas";
import * as companyService from "./company.service";
import { getCompanyDetails } from "./company.settings";

/**
 * Masti's own details (docs/decisions/0008-visa-docket-dispatch.md Decision 5). Every department prints them, so there
 * is no department check: the Head and office staff read them, only the Head changes them. Field staff get nothing here.
 */
const router = Router();
router.use(requireAuth, requirePasswordChanged, requireUserType("HEAD", "OFFICE"));

router.get("/details", async (_req, res) => {
  res.json({ details: await getCompanyDetails() });
});

router.put("/details", requireHead, async (req, res) => {
  const body = updateCompanyDetailsSchema.parse(req.body);
  res.json({ details: await companyService.updateCompanyDetails(body, actorOf(req)) });
});

export default router;
