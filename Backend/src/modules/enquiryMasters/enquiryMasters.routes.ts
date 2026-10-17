import { Router } from "express";
import { z } from "zod";
import { actorOf, requireAuth, requirePasswordChanged, requireUserType } from "../../middleware/auth";
import {
  createOptionSchema,
  createReasonSchema,
  createSlotSchema,
  listQuerySchema,
  updateOptionSchema,
  updateReasonSchema,
  updateSlotSchema,
} from "./enquiryMasters.schemas";
import { updateFieldSettingsSchema } from "../fieldJobs/field.schemas";
import { getFieldSettings } from "../fieldJobs/fieldJobs.settings";
import * as service from "./enquiryMasters.service";

/**
 * Follow-up outcomes, next steps and postpone/cancel reasons (docs/decisions/0006-visa-documents.md Decision 7), and the
 * collection and delivery boy's time slots and the reasons a visit fails (docs/decisions/0015-field-staff-app.md
 * Decisions 2 and 5).
 * The Head and office staff read them (the dropdowns on every case); the service lets the Head or any HOD write.
 */
const router = Router();
router.use(requireAuth, requirePasswordChanged, requireUserType("HEAD", "OFFICE"));

const idParam = z.coerce.number().int().positive();

// Follow-up outcomes ("What happened")
router.get("/follow-up-outcomes", async (req, res) => {
  const { active } = listQuerySchema.parse(req.query);
  res.json({ outcomes: await service.listOutcomes(active) });
});
router.post("/follow-up-outcomes", async (req, res) => {
  const body = createOptionSchema.parse(req.body);
  res.status(201).json({ outcome: await service.createOutcome(body, actorOf(req)) });
});
router.patch("/follow-up-outcomes/:id", async (req, res) => {
  const body = updateOptionSchema.parse(req.body);
  res.json({ outcome: await service.updateOutcome(idParam.parse(req.params.id), body, actorOf(req)) });
});

// Follow-up next steps
router.get("/follow-up-next-steps", async (req, res) => {
  const { active } = listQuerySchema.parse(req.query);
  res.json({ nextSteps: await service.listNextSteps(active) });
});
router.post("/follow-up-next-steps", async (req, res) => {
  const body = createOptionSchema.parse(req.body);
  res.status(201).json({ nextStep: await service.createNextStep(body, actorOf(req)) });
});
router.patch("/follow-up-next-steps/:id", async (req, res) => {
  const body = updateOptionSchema.parse(req.body);
  res.json({ nextStep: await service.updateNextStep(idParam.parse(req.params.id), body, actorOf(req)) });
});

// Postpone and cancel reasons
router.get("/enquiry-reasons", async (req, res) => {
  const { active } = listQuerySchema.parse(req.query);
  res.json({ reasons: await service.listReasons(active) });
});
router.post("/enquiry-reasons", async (req, res) => {
  const body = createReasonSchema.parse(req.body);
  res.status(201).json({ reason: await service.createReason(body, actorOf(req)) });
});
router.patch("/enquiry-reasons/:id", async (req, res) => {
  const body = updateReasonSchema.parse(req.body);
  res.json({ reason: await service.updateReason(idParam.parse(req.params.id), body, actorOf(req)) });
});

// The collection and delivery boy's time slots
router.get("/field-slots", async (req, res) => {
  const { active } = listQuerySchema.parse(req.query);
  res.json({ slots: await service.listSlots(active) });
});
router.post("/field-slots", async (req, res) => {
  const body = createSlotSchema.parse(req.body);
  res.status(201).json({ slot: await service.createSlot(body, actorOf(req)) });
});
router.patch("/field-slots/:id", async (req, res) => {
  const body = updateSlotSchema.parse(req.body);
  res.json({ slot: await service.updateSlot(idParam.parse(req.params.id), body, actorOf(req)) });
});

// Why a visit fails (his "Couldn't complete")
router.get("/field-fail-reasons", async (req, res) => {
  const { active } = listQuerySchema.parse(req.query);
  res.json({ reasons: await service.listFailReasons(active) });
});
router.post("/field-fail-reasons", async (req, res) => {
  const body = createOptionSchema.parse(req.body);
  res.status(201).json({ reason: await service.createFailReason(body, actorOf(req)) });
});
router.patch("/field-fail-reasons/:id", async (req, res) => {
  const body = updateOptionSchema.parse(req.body);
  res.json({ reason: await service.updateFailReason(idParam.parse(req.params.id), body, actorOf(req)) });
});

// The field staff app's settings (0015 Decision 8): how long the client's code works, its tries and resend wait, and
// the largest selfie
router.get("/field-settings", async (_req, res) => {
  res.json({ settings: await getFieldSettings() });
});
router.put("/field-settings", async (req, res) => {
  const body = updateFieldSettingsSchema.parse(req.body);
  res.json({ settings: await service.updateFieldSettings(body, actorOf(req)) });
});

export default router;
