import { Router } from "express";
import { z } from "zod";
import { actorOf, requireAuth, requireDepartment, requirePasswordChanged, requireUserType } from "../../middleware/auth";
import {
  addWordingSchema,
  coveringLetterListQuerySchema,
  createCoveringLetterSchema,
  removeWordingSchema,
  updateCoveringLetterSchema,
} from "./coveringLetters.schemas";
import * as coveringLettersService from "./coveringLetters.service";

/**
 * The covering-letter formats (docs/decisions/0019-covering-letters.md), under /api/masters. Visa VIEW to read, Visa EDIT
 * to write; the service then requires the Visa HOD (or the Head). A format is switched off, never deleted.
 */
const router = Router();
router.use(requireAuth, requirePasswordChanged, requireUserType("HEAD", "OFFICE"));

const visaView = requireDepartment("VISA", "VIEW");
const visaEdit = requireDepartment("VISA", "EDIT");
const idParam = z.coerce.number().int().positive();

router.get("/covering-letters", visaView, async (req, res) => {
  res.json({ formats: await coveringLettersService.listFormats(coveringLetterListQuerySchema.parse(req.query)) });
});

router.get("/covering-letters/:id", visaView, async (req, res) => {
  res.json({ format: await coveringLettersService.getFormat(idParam.parse(req.params.id)) });
});

router.post("/covering-letters", visaEdit, async (req, res) => {
  const body = createCoveringLetterSchema.parse(req.body);
  res.status(201).json({ format: await coveringLettersService.createFormat(body, actorOf(req)) });
});

router.patch("/covering-letters/:id", visaEdit, async (req, res) => {
  const body = updateCoveringLetterSchema.parse(req.body);
  res.json({ format: await coveringLettersService.updateFormat(idParam.parse(req.params.id), body, actorOf(req)) });
});

router.post("/covering-letters/:id/versions", visaEdit, async (req, res) => {
  const body = addWordingSchema.parse(req.body);
  res.status(201).json({ format: await coveringLettersService.addVersion(idParam.parse(req.params.id), body, actorOf(req)) });
});

router.delete("/covering-letters/:id/versions/:versionId", visaEdit, async (req, res) => {
  const body = removeWordingSchema.parse(req.body);
  const format = await coveringLettersService.removeVersion(idParam.parse(req.params.id), idParam.parse(req.params.versionId), body, actorOf(req));
  res.json({ format });
});

export default router;
