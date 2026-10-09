import { Router } from "express";
import { z } from "zod";
import { actorOf, requireAuth, requireDepartment, requirePasswordChanged, requireUserType } from "../../middleware/auth";
import { createVisaCaseSchema, idempotencyKeySchema, updateVisaSettingsSchema } from "./visa.schemas";
import * as visaService from "./visa.service";

/** Visa cases (docs/decisions/0003-visa-intake.md). Visa VIEW to read, Visa EDIT to save. */
const router = Router();
router.use(requireAuth, requirePasswordChanged, requireUserType("HEAD", "OFFICE"));

const visaView = requireDepartment("VISA", "VIEW");
const visaEdit = requireDepartment("VISA", "EDIT");
const caseNoParam = z.string().trim().min(1).max(40);

/** Country and visa-type dropdowns on the New enquiry form. */
router.get("/offerings", visaView, async (_req, res) => {
  res.json({ countries: await visaService.listIntakeOfferings() });
});

/** "Save enquiry". Optional Idempotency-Key header: a repeat returns the same case with 200. */
router.post("/cases", visaEdit, async (req, res) => {
  const body = createVisaCaseSchema.parse(req.body);
  const key = idempotencyKeySchema.parse(req.get("Idempotency-Key") || undefined);
  const result = await visaService.createVisaEnquiry(body, "STAFF", actorOf(req), key);
  res.status(result.replayed ? 200 : 201).json({ case: result.case, clientCreated: result.clientCreated });
});

router.get("/cases/:caseNo", visaView, async (req, res) => {
  res.json({ case: await visaService.getVisaCase(caseNoParam.parse(req.params.caseNo)) });
});

router.get("/settings", visaView, async (_req, res) => {
  res.json({ settings: await visaService.getSettings() });
});

/** The service also requires the Visa HOD (or the Head). */
router.put("/settings", visaEdit, async (req, res) => {
  const body = updateVisaSettingsSchema.parse(req.body);
  res.json({ settings: await visaService.updateSettings(body, actorOf(req)) });
});

export default router;
