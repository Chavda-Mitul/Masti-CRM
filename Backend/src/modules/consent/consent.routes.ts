import { Router } from "express";
import { z } from "zod";
import { actorOf, requireAuth, requireDepartment, requirePasswordChanged, requireUserType } from "../../middleware/auth";
import { listQuerySchema } from "../visaMasters/visaMasters.schemas";
import { addConsentWordingSchema, createConsentFieldSchema, orderConsentFieldsSchema, updateConsentFieldSchema } from "./consent.schemas";
import * as consentService from "./consent.service";

/**
 * The consent form in Settings, under /api/masters: its wording (docs/decisions/0022-consent-form.md, part 2b) and its
 * fields (amendment 1). Visa VIEW to read, Visa EDIT to change; the service then requires the Visa HOD (or the Head),
 * as for covering letters.
 */
const router = Router();
router.use(requireAuth, requirePasswordChanged, requireUserType("HEAD", "OFFICE"));

const visaView = requireDepartment("VISA", "VIEW");
const visaEdit = requireDepartment("VISA", "EDIT");
const idParam = z.coerce.number().int().positive();

router.get("/consent-wording", visaView, async (_req, res) => {
  res.json({ versions: await consentService.listConsentWordings() });
});

router.post("/consent-wording", visaEdit, async (req, res) => {
  const body = addConsentWordingSchema.parse(req.body);
  res.status(201).json({ versions: await consentService.addConsentWording(body, actorOf(req)) });
});

router.get("/consent-fields", visaView, async (req, res) => {
  const { active } = listQuerySchema.parse(req.query);
  res.json({ fields: await consentService.listConsentFields(active) });
});

router.post("/consent-fields", visaEdit, async (req, res) => {
  const body = createConsentFieldSchema.parse(req.body);
  res.status(201).json({ field: await consentService.createConsentField(body, actorOf(req)) });
});

/** The whole order at once: every field's id, first to last. */
router.put("/consent-fields/order", visaEdit, async (req, res) => {
  const body = orderConsentFieldsSchema.parse(req.body);
  res.json({ fields: await consentService.orderConsentFields(body, actorOf(req)) });
});

router.patch("/consent-fields/:id", visaEdit, async (req, res) => {
  const body = updateConsentFieldSchema.parse(req.body);
  res.json({ field: await consentService.updateConsentField(idParam.parse(req.params.id), body, actorOf(req)) });
});

export default router;
