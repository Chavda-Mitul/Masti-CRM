import { Router } from "express";
import { z } from "zod";
import { actorOf, currentUser, requireAuth, requireDepartment, requirePasswordChanged, requireUserType } from "../../middleware/auth";
import {
  checkCaseDocumentSchema,
  createVisaCaseSchema,
  idempotencyKeySchema,
  linkTravellerSchema,
  matureCaseSchema,
  updateCaseDocumentSchema,
  updateVisaCaseSchema,
  updateVisaSettingsSchema,
} from "./visa.schemas";
import * as visaService from "./visa.service";
import * as filePrepService from "./visaFilePrep.service";
import * as stepsService from "./visaSteps.service";

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
  res.json({ case: await visaService.getVisaCase(caseNoParam.parse(req.params.caseNo), currentUser(req)) });
});

// Step 2 (docs/decisions/0006-visa-documents.md). The service also requires the case's owner, its HOD or the Head.
const idParam = z.string().trim().min(1).max(64);

/** "Start collecting documents": Enquiry → Documents. */
router.post("/cases/:caseNo/start", visaEdit, async (req, res) => {
  res.json({ case: await stepsService.startDocuments(caseNoParam.parse(req.params.caseNo), actorOf(req)) });
});

/** How the documents reach us, and booklets received. */
router.patch("/cases/:caseNo", visaEdit, async (req, res) => {
  const body = updateVisaCaseSchema.parse(req.body);
  res.json({ case: await stepsService.updateCase(caseNoParam.parse(req.params.caseNo), body, actorOf(req)) });
});

/** Tick one paper: Original/Xerox, Made, Not needed, or back to Pending. */
router.patch("/cases/:caseNo/documents/:documentId", visaEdit, async (req, res) => {
  const body = updateCaseDocumentSchema.parse(req.body);
  const caseNo = caseNoParam.parse(req.params.caseNo);
  res.json({ case: await stepsService.updateDocument(caseNo, idParam.parse(req.params.documentId), body, actorOf(req)) });
});

/** Name a traveller: link the client's family member. */
router.put("/cases/:caseNo/travellers/:travellerId/member", visaEdit, async (req, res) => {
  const body = linkTravellerSchema.parse(req.body);
  const caseNo = caseNoParam.parse(req.params.caseNo);
  res.json({ case: await stepsService.linkTraveller(caseNo, idParam.parse(req.params.travellerId), body, actorOf(req)) });
});

/** "Mark documents complete": the case moves to File preparation, unowned, for the HOD to give to a processor. */
router.post("/cases/:caseNo/mature", visaEdit, async (req, res) => {
  const body = matureCaseSchema.parse(req.body);
  res.json({ case: await stepsService.mature(caseNoParam.parse(req.params.caseNo), body, actorOf(req)) });
});

// Step 3 (docs/decisions/0007-visa-file-prep.md). The service also requires the case's owner, its HOD or the Head.

/** The processor's check of one paper: Checked, Needs replacing (with a reason), or back to "to check". */
router.patch("/cases/:caseNo/documents/:documentId/check", visaEdit, async (req, res) => {
  const body = checkCaseDocumentSchema.parse(req.body);
  const caseNo = caseNoParam.parse(req.params.caseNo);
  res.json({ case: await filePrepService.checkDocument(caseNo, idParam.parse(req.params.documentId), body, actorOf(req)) });
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
