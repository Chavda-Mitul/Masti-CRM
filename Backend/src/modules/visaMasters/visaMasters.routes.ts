import { Router } from "express";
import { z } from "zod";
import { actorOf, requireAuth, requireDepartment, requirePasswordChanged, requireUserType } from "../../middleware/auth";
import * as checklistsService from "./checklists.service";
import {
  createCountrySchema,
  createDocumentProblemReasonSchema,
  createDocumentSchema,
  createEmbassySchema,
  createEnquirySourceSchema,
  createOfferingSchema,
  createCourierSchema,
  createCreditNoteReasonSchema,
  createRecallReasonSchema,
  createMissingPassportReasonSchema,
  createExtraChargeSchema,
  createProcessingSpeedSchema,
  createVisaTypeSchema,
  embassyListQuerySchema,
  listQuerySchema,
  replaceChecklistSchema,
  updateCountrySchema,
  updateDocumentProblemReasonSchema,
  updateDocumentSchema,
  updateEmbassySchema,
  updateEnquirySourceSchema,
  updateOfferingSchema,
  updateCourierSchema,
  updateCreditNoteReasonSchema,
  updateRecallReasonSchema,
  updateMissingPassportReasonSchema,
  updateExtraChargeSchema,
  updateProcessingSpeedSchema,
  updateVisaTypeSchema,
} from "./visaMasters.schemas";
import * as mastersService from "./visaMasters.service";

/**
 * System masters for visas, plus embassies (docs/decisions/0005-system-masters.md).
 * Visa masters: Visa VIEW to read, Visa EDIT to write; the service then requires the Visa HOD (or the Head).
 * Embassies are holiday targets for every department: the Head and office staff read them; the Head or any HOD writes.
 */
const router = Router();
router.use(requireAuth, requirePasswordChanged, requireUserType("HEAD", "OFFICE"));

const visaView = requireDepartment("VISA", "VIEW");
const visaEdit = requireDepartment("VISA", "EDIT");
const idParam = z.coerce.number().int().positive();

// Countries
router.get("/countries", visaView, async (req, res) => {
  const { active } = listQuerySchema.parse(req.query);
  res.json({ countries: await mastersService.listCountries(active) });
});
router.post("/countries", visaEdit, async (req, res) => {
  const body = createCountrySchema.parse(req.body);
  res.status(201).json({ country: await mastersService.createCountry(body, actorOf(req)) });
});
router.patch("/countries/:id", visaEdit, async (req, res) => {
  const body = updateCountrySchema.parse(req.body);
  res.json({ country: await mastersService.updateCountry(idParam.parse(req.params.id), body, actorOf(req)) });
});

// Visa types
router.get("/visa-types", visaView, async (req, res) => {
  const { active } = listQuerySchema.parse(req.query);
  res.json({ visaTypes: await mastersService.listVisaTypes(active) });
});
router.post("/visa-types", visaEdit, async (req, res) => {
  const body = createVisaTypeSchema.parse(req.body);
  res.status(201).json({ visaType: await mastersService.createVisaType(body, actorOf(req)) });
});
router.patch("/visa-types/:id", visaEdit, async (req, res) => {
  const body = updateVisaTypeSchema.parse(req.body);
  res.json({ visaType: await mastersService.updateVisaType(idParam.parse(req.params.id), body, actorOf(req)) });
});

// Embassies (no department check: the service allows the Head or any HOD to write)
router.get("/embassies", async (req, res) => {
  res.json({ embassies: await mastersService.listEmbassies(embassyListQuerySchema.parse(req.query)) });
});
router.post("/embassies", async (req, res) => {
  const body = createEmbassySchema.parse(req.body);
  res.status(201).json({ embassy: await mastersService.createEmbassy(body, actorOf(req)) });
});
router.patch("/embassies/:id", async (req, res) => {
  const body = updateEmbassySchema.parse(req.body);
  res.json({ embassy: await mastersService.updateEmbassy(idParam.parse(req.params.id), body, actorOf(req)) });
});

// Documents
router.get("/documents", visaView, async (req, res) => {
  const { active } = listQuerySchema.parse(req.query);
  res.json({ documents: await mastersService.listDocuments(active) });
});
router.post("/documents", visaEdit, async (req, res) => {
  const body = createDocumentSchema.parse(req.body);
  res.status(201).json({ document: await mastersService.createDocument(body, actorOf(req)) });
});
router.patch("/documents/:id", visaEdit, async (req, res) => {
  const body = updateDocumentSchema.parse(req.body);
  res.json({ document: await mastersService.updateDocument(idParam.parse(req.params.id), body, actorOf(req)) });
});

// Document problems: why a paper needs replacing in Step 3 (docs/decisions/0007-visa-file-prep.md Decision 3)
router.get("/document-problem-reasons", visaView, async (req, res) => {
  const { active } = listQuerySchema.parse(req.query);
  res.json({ problemReasons: await mastersService.listDocumentProblemReasons(active) });
});
router.post("/document-problem-reasons", visaEdit, async (req, res) => {
  const body = createDocumentProblemReasonSchema.parse(req.body);
  res.status(201).json({ problemReason: await mastersService.createDocumentProblemReason(body, actorOf(req)) });
});
router.patch("/document-problem-reasons/:id", visaEdit, async (req, res) => {
  const body = updateDocumentProblemReasonSchema.parse(req.body);
  res.json({ problemReason: await mastersService.updateDocumentProblemReason(idParam.parse(req.params.id), body, actorOf(req)) });
});

// Processing speeds: picked on a visa case's quote (docs/decisions/0009-visa-invoice.md)
router.get("/processing-speeds", visaView, async (req, res) => {
  const { active } = listQuerySchema.parse(req.query);
  res.json({ processingSpeeds: await mastersService.listProcessingSpeeds(active) });
});
router.post("/processing-speeds", visaEdit, async (req, res) => {
  const body = createProcessingSpeedSchema.parse(req.body);
  res.status(201).json({ processingSpeed: await mastersService.createProcessingSpeed(body, actorOf(req)) });
});
router.patch("/processing-speeds/:id", visaEdit, async (req, res) => {
  const body = updateProcessingSpeedSchema.parse(req.body);
  res.json({ processingSpeed: await mastersService.updateProcessingSpeed(idParam.parse(req.params.id), body, actorOf(req)) });
});

// Couriers: how a docket goes to the vendor (docs/decisions/0008-visa-docket-dispatch.md Decision 6)
router.get("/couriers", visaView, async (req, res) => {
  const { active } = listQuerySchema.parse(req.query);
  res.json({ couriers: await mastersService.listCouriers(active) });
});
router.post("/couriers", visaEdit, async (req, res) => {
  const body = createCourierSchema.parse(req.body);
  res.status(201).json({ courier: await mastersService.createCourier(body, actorOf(req)) });
});
router.patch("/couriers/:id", visaEdit, async (req, res) => {
  const body = updateCourierSchema.parse(req.body);
  res.json({ courier: await mastersService.updateCourier(idParam.parse(req.params.id), body, actorOf(req)) });
});

// Credit-note reasons (docs/decisions/0011-visa-at-vendor.md Decision 5)
router.get("/credit-note-reasons", visaView, async (req, res) => {
  const { active } = listQuerySchema.parse(req.query);
  res.json({ creditNoteReasons: await mastersService.listCreditNoteReasons(active) });
});
router.post("/credit-note-reasons", visaEdit, async (req, res) => {
  const body = createCreditNoteReasonSchema.parse(req.body);
  res.status(201).json({ creditNoteReason: await mastersService.createCreditNoteReason(body, actorOf(req)) });
});
router.patch("/credit-note-reasons/:id", visaEdit, async (req, res) => {
  const body = updateCreditNoteReasonSchema.parse(req.body);
  res.json({ creditNoteReason: await mastersService.updateCreditNoteReason(idParam.parse(req.params.id), body, actorOf(req)) });
});

// Recall reasons (docs/decisions/0011-visa-at-vendor.md Decision 6)
router.get("/recall-reasons", visaView, async (req, res) => {
  const { active } = listQuerySchema.parse(req.query);
  res.json({ recallReasons: await mastersService.listRecallReasons(active) });
});
router.post("/recall-reasons", visaEdit, async (req, res) => {
  const body = createRecallReasonSchema.parse(req.body);
  res.status(201).json({ recallReason: await mastersService.createRecallReason(body, actorOf(req)) });
});
router.patch("/recall-reasons/:id", visaEdit, async (req, res) => {
  const body = updateRecallReasonSchema.parse(req.body);
  res.json({ recallReason: await mastersService.updateRecallReason(idParam.parse(req.params.id), body, actorOf(req)) });
});

// Missing passport reasons (docs/decisions/0013-visa-passport-back.md Decision 5, amended 17 Oct 2026)
router.get("/missing-passport-reasons", visaView, async (req, res) => {
  const { active } = listQuerySchema.parse(req.query);
  res.json({ missingPassportReasons: await mastersService.listMissingPassportReasons(active) });
});
router.post("/missing-passport-reasons", visaEdit, async (req, res) => {
  const body = createMissingPassportReasonSchema.parse(req.body);
  res.status(201).json({ missingPassportReason: await mastersService.createMissingPassportReason(body, actorOf(req)) });
});
router.patch("/missing-passport-reasons/:id", visaEdit, async (req, res) => {
  const body = updateMissingPassportReasonSchema.parse(req.body);
  res.json({ missingPassportReason: await mastersService.updateMissingPassportReason(idParam.parse(req.params.id), body, actorOf(req)) });
});

// Extra charges, for the additional invoice (docs/decisions/0011-visa-at-vendor.md Decision 7)
router.get("/extra-charges", visaView, async (req, res) => {
  const { active } = listQuerySchema.parse(req.query);
  res.json({ extraCharges: await mastersService.listExtraCharges(active) });
});
router.post("/extra-charges", visaEdit, async (req, res) => {
  const body = createExtraChargeSchema.parse(req.body);
  res.status(201).json({ extraCharge: await mastersService.createExtraCharge(body, actorOf(req)) });
});
router.patch("/extra-charges/:id", visaEdit, async (req, res) => {
  const body = updateExtraChargeSchema.parse(req.body);
  res.json({ extraCharge: await mastersService.updateExtraCharge(idParam.parse(req.params.id), body, actorOf(req)) });
});

// Enquiry sources ("Came in through")
router.get("/enquiry-sources", visaView, async (req, res) => {
  const { active } = listQuerySchema.parse(req.query);
  res.json({ sources: await mastersService.listEnquirySources(active) });
});
router.post("/enquiry-sources", visaEdit, async (req, res) => {
  const body = createEnquirySourceSchema.parse(req.body);
  res.status(201).json({ source: await mastersService.createEnquirySource(body, actorOf(req)) });
});
router.patch("/enquiry-sources/:id", visaEdit, async (req, res) => {
  const body = updateEnquirySourceSchema.parse(req.body);
  res.json({ source: await mastersService.updateEnquirySource(idParam.parse(req.params.id), body, actorOf(req)) });
});

// Offerings (country × visa type) and their checklists
router.get("/visa-offerings", visaView, async (req, res) => {
  const { active } = listQuerySchema.parse(req.query);
  res.json({ offerings: await mastersService.listOfferings(active) });
});
router.post("/visa-offerings", visaEdit, async (req, res) => {
  const body = createOfferingSchema.parse(req.body);
  res.status(201).json({ offering: await mastersService.createOffering(body, actorOf(req)) });
});
router.patch("/visa-offerings/:id", visaEdit, async (req, res) => {
  const body = updateOfferingSchema.parse(req.body);
  res.json({ offering: await mastersService.updateOffering(idParam.parse(req.params.id), body, actorOf(req)) });
});
router.get("/visa-offerings/:id/checklist", visaView, async (req, res) => {
  res.json(await checklistsService.getChecklist(idParam.parse(req.params.id)));
});
router.put("/visa-offerings/:id/checklist", visaEdit, async (req, res) => {
  const body = replaceChecklistSchema.parse(req.body);
  res.json(await checklistsService.replaceChecklist(idParam.parse(req.params.id), body, actorOf(req)));
});

export default router;
