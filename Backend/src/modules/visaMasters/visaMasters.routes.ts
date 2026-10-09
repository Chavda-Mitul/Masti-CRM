import { Router } from "express";
import { z } from "zod";
import { actorOf, requireAuth, requireDepartment, requirePasswordChanged, requireUserType } from "../../middleware/auth";
import * as checklistsService from "./checklists.service";
import {
  createCountrySchema,
  createDocumentSchema,
  createEmbassySchema,
  createEnquirySourceSchema,
  createOfferingSchema,
  createVisaTypeSchema,
  embassyListQuerySchema,
  listQuerySchema,
  replaceChecklistSchema,
  updateCountrySchema,
  updateDocumentSchema,
  updateEmbassySchema,
  updateEnquirySourceSchema,
  updateOfferingSchema,
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
