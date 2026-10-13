import { Router } from "express";
import { z } from "zod";
import { HttpError } from "../../lib/httpError";
import { readBody } from "../../lib/readBody";
import { actorOf, currentUser, requireAuth, requireDepartment, requirePasswordChanged, requireUserType } from "../../middleware/auth";
import {
  addToDocketSchema,
  checkCaseDocumentSchema,
  createVisaCaseSchema,
  fileReadySchema,
  idempotencyKeySchema,
  linkTravellerSchema,
  saveQuoteSchema,
  matureCaseSchema,
  setVendorSchema,
  takeOutOfDocketSchema,
  updateApplicationSchema,
  updateCaseDocumentSchema,
  updateTripSchema,
  updateVisaCaseSchema,
  updateVisaSettingsSchema,
} from "./visa.schemas";
import * as visaService from "./visa.service";
import * as docketService from "./visaDocket.service";
import * as filePrepService from "./visaFilePrep.service";
import * as quoteService from "./visaQuote.service";
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

/** Trip details: travelling out, coming back, the entry type and the hotel stay (Documents or File preparation). */
router.patch("/cases/:caseNo/trip", visaEdit, async (req, res) => {
  const body = updateTripSchema.parse(req.body);
  res.json({ case: await stepsService.updateTrip(caseNoParam.parse(req.params.caseNo), body, actorOf(req)) });
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

/** One traveller's acknowledgement number and appointment, from the government portal. */
router.patch("/cases/:caseNo/travellers/:travellerId/application", visaEdit, async (req, res) => {
  const body = updateApplicationSchema.parse(req.body);
  const caseNo = caseNoParam.parse(req.params.caseNo);
  res.json({ case: await filePrepService.updateApplication(caseNo, idParam.parse(req.params.travellerId), body, actorOf(req)) });
});

/** "File ready — add to docket": 409 NOT_READY with details.missing until Step 3 is complete. */
router.post("/cases/:caseNo/file-ready", visaEdit, async (req, res) => {
  const body = fileReadySchema.parse(req.body);
  res.json({ case: await filePrepService.markFileReady(caseNoParam.parse(req.params.caseNo), body, actorOf(req)) });
});

/** The case's vendor, from the active vendors covering its country; null clears it. */
router.put("/cases/:caseNo/vendor", visaEdit, async (req, res) => {
  const body = setVendorSchema.parse(req.body);
  res.json({ case: await filePrepService.setVendor(caseNoParam.parse(req.params.caseNo), body, actorOf(req)) });
});

/** The quote (docs/decisions/0009-visa-invoice.md Decision 2): every amount the invoice will print, saved whole. */
router.put("/cases/:caseNo/quote", visaEdit, async (req, res) => {
  const body = saveQuoteSchema.parse(req.body);
  res.json({ case: await quoteService.saveQuote(caseNoParam.parse(req.params.caseNo), body, actorOf(req)) });
});

/** Step 4 (docs/decisions/0008-visa-docket-dispatch.md): join the vendor's docket (GROUP) or start one of its own (OWN). */
router.post("/cases/:caseNo/docket", visaEdit, async (req, res) => {
  const body = addToDocketSchema.parse(req.body);
  res.json({ case: await docketService.addToDocket(caseNoParam.parse(req.params.caseNo), body, actorOf(req)) });
});

/** The docket's parcel sticker (0008 Decision 5): anyone who can open the case can print it. */
router.get("/cases/:caseNo/sticker", visaView, async (req, res) => {
  res.json({ sticker: await docketService.docketSticker(caseNoParam.parse(req.params.caseNo), currentUser(req)) });
});

/** Take the case out of its docket, while the docket is open. */
router.delete("/cases/:caseNo/docket", visaEdit, async (req, res) => {
  const body = takeOutOfDocketSchema.parse(req.body);
  res.json({ case: await docketService.takeOutOfDocket(caseNoParam.parse(req.params.caseNo), body, actorOf(req)) });
});

/**
 * Upload the final file: the PDF itself is the body (Content-Type: application/pdf), not a form. The case and the size
 * limit are checked before the body is read.
 */
router.post("/cases/:caseNo/files/final", visaEdit, async (req, res) => {
  if (!(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/pdf")) {
    throw new HttpError(415, "Upload the file as a PDF.");
  }
  const caseNo = caseNoParam.parse(req.params.caseNo);
  const actor = actorOf(req);
  const { maxBytes, tooBig } = await filePrepService.finalFileLimit(caseNo, actor);
  const bytes = await readBody(req, maxBytes, tooBig);
  res.json({ case: await filePrepService.uploadFinalFile(caseNo, bytes, actor) });
});

/** A short-lived link that opens one of the case's files ({ url, expiresAt }). Opening is audited. */
router.get("/cases/:caseNo/files/:fileId/link", visaView, async (req, res) => {
  const caseNo = caseNoParam.parse(req.params.caseNo);
  res.json(await filePrepService.openCaseFile(caseNo, idParam.parse(req.params.fileId), actorOf(req)));
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
