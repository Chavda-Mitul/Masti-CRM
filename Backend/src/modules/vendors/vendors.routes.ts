import { Router } from "express";
import { z } from "zod";
import { actorOf, requireAuth, requireDepartment, requirePasswordChanged, requireUserType } from "../../middleware/auth";
import { createVendorSchema, updateVendorSchema, vendorListQuerySchema } from "./vendors.schemas";
import * as vendorsService from "./vendors.service";

/**
 * The vendor master (docs/decisions/0007-visa-file-prep.md Decision 7), under /api/masters. Visa VIEW to read, Visa EDIT
 * to write; the service then requires the Visa HOD (or the Head).
 */
const router = Router();
router.use(requireAuth, requirePasswordChanged, requireUserType("HEAD", "OFFICE"));

const visaView = requireDepartment("VISA", "VIEW");
const visaEdit = requireDepartment("VISA", "EDIT");
const idParam = z.coerce.number().int().positive();

router.get("/vendors", visaView, async (req, res) => {
  res.json({ vendors: await vendorsService.listVendors(vendorListQuerySchema.parse(req.query)) });
});

router.post("/vendors", visaEdit, async (req, res) => {
  const body = createVendorSchema.parse(req.body);
  res.status(201).json({ vendor: await vendorsService.createVendor(body, actorOf(req)) });
});

router.patch("/vendors/:id", visaEdit, async (req, res) => {
  const body = updateVendorSchema.parse(req.body);
  res.json({ vendor: await vendorsService.updateVendor(idParam.parse(req.params.id), body, actorOf(req)) });
});

export default router;
