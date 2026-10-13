import { Router } from "express";
import { HttpError } from "../../lib/httpError";
import { readBody } from "../../lib/readBody";
import { actorOf, requireAuth, requireHead, requirePasswordChanged, requireUserType } from "../../middleware/auth";
import { companyImageKindSchema, invoiceTermsSchema, updateCompanyDetailsSchema } from "./company.schemas";
import * as companyService from "./company.service";
import { getInvoiceTerms } from "./company.settings";

/**
 * Masti's own details, the invoice's terms, and its logo and signature (docs/decisions/0008-visa-docket-dispatch.md
 * Decision 5, docs/decisions/0009-visa-invoice.md Decision 8). Every department prints them, so there is no department
 * check: the Head and office staff read them, only the Head changes them. Field staff get nothing here.
 */
const router = Router();
router.use(requireAuth, requirePasswordChanged, requireUserType("HEAD", "OFFICE"));

/** The details, the current logo and signature, and what the first invoice still needs. */
router.get("/details", async (_req, res) => {
  res.json(await companyService.getCompanyView());
});

router.put("/details", requireHead, async (req, res) => {
  const body = updateCompanyDetailsSchema.parse(req.body);
  res.json(await companyService.updateCompanyDetails(body, actorOf(req)));
});

router.get("/invoice-terms", async (_req, res) => {
  res.json({ terms: await getInvoiceTerms() });
});

router.put("/invoice-terms", requireHead, async (req, res) => {
  const body = invoiceTermsSchema.parse(req.body);
  res.json({ terms: await companyService.updateInvoiceTerms(body, actorOf(req)) });
});

/** The image itself is the body (image/png or image/jpeg), not a form. The type and size are checked before reading. */
router.put("/images/:kind", requireHead, async (req, res) => {
  const kind = companyImageKindSchema.parse(req.params.kind);
  const contentType = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  if (contentType !== "image/png" && contentType !== "image/jpeg") throw new HttpError(415, "Upload a PNG or JPEG image.");
  const bytes = await readBody(req, companyService.MAX_IMAGE_BYTES, "This image is over 2 MB. Save it smaller and upload it again.");
  res.json(await companyService.uploadCompanyImage(kind, contentType, bytes, actorOf(req)));
});

router.get("/images/:kind/link", async (req, res) => {
  res.json(await companyService.companyImageLink(companyImageKindSchema.parse(req.params.kind)));
});

export default router;
