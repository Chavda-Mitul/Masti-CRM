import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import type { CompanyImageKind } from "../../../generated/prisma/enums";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { badRequest, fieldError, notFound } from "../../lib/httpError";
import { saveSetting } from "../../lib/settings";
import { deleteObject, presignGet, putObject } from "../../lib/storage";
import { GST_STATES } from "../clients/clients.schemas";
import type { Actor } from "../users/user";
import type { CompanyDetails, CompanyImageKindParam, InvoiceTerms, UpdateCompanyDetailsInput } from "./company.schemas";
import { COMPANY_DETAILS_KEY, getCompanyDetails, getInvoiceTerms, INVOICE_TERMS_KEY, invoiceMissing } from "./company.settings";

// Masti's own details, the invoice's terms, and its logo and signature (docs/decisions/0008-visa-docket-dispatch.md
// Decision 5, docs/decisions/0009-visa-invoice.md Decision 8). The Head changes them; every office user reads them.

const KIND: Record<CompanyImageKindParam, CompanyImageKind> = { logo: "LOGO", signature: "SIGNATURE" };

/** The current image of a kind: the newest upload. */
async function currentImage(kind: CompanyImageKind) {
  return prisma.companyImage.findFirst({
    where: { kind },
    orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
    include: { uploadedBy: { select: { id: true, name: true } } },
  });
}

const imageView = (image: Awaited<ReturnType<typeof currentImage>>) =>
  image && { contentType: image.contentType, sizeBytes: image.sizeBytes, uploadedAt: image.uploadedAt, uploadedBy: image.uploadedBy };

/** What the Masters page shows: the details, the two images, and what the first invoice still needs. */
export async function getCompanyView() {
  const [details, logo, signature] = await Promise.all([getCompanyDetails(), currentImage("LOGO"), currentImage("SIGNATURE")]);
  const images = { logo: imageView(logo), signature: imageView(signature) };
  return { details, images, missingForInvoice: invoiceMissing(details, images) };
}

/**
 * The GSTIN's PAN (characters 3–12) and state (the first two) must match the PAN and state entered; an empty one is
 * filled from the GSTIN. The same rules as a client's (clients.service.ts), since the invoice prints them.
 */
function alignWithGstin(details: CompanyDetails) {
  const gstin = details.gstin;
  if (!gstin) return details;
  const panInGstin = gstin.slice(2, 12);
  if (details.pan === null) details = { ...details, pan: panInGstin };
  else if (details.pan !== panInGstin) throw fieldError("pan", `The PAN inside this GSTIN (${panInGstin}) doesn't match the PAN entered.`);
  const stateInGstin = gstin.slice(0, 2);
  const gstinState = GST_STATES.find((s) => s.code === stateInGstin);
  if (details.stateCode === null) {
    if (gstinState) details = { ...details, stateCode: stateInGstin };
  } else if (details.stateCode !== stateInGstin) {
    const entered = GST_STATES.find((s) => s.code === details.stateCode)?.name ?? details.stateCode;
    throw fieldError(
      "stateCode",
      gstinState
        ? `This GSTIN is registered in ${gstinState.name}, not ${entered}. Pick ${gstinState.name}, or leave the state empty to fill it from the GSTIN.`
        : `This GSTIN's state code (${stateInGstin}) isn't a GST state. Leave the state empty.`,
    );
  }
  return details;
}

/** The Head only (the route checks). Only a real change is written, audited as setting.update. */
export async function updateCompanyDetails(input: UpdateCompanyDetailsInput, actor: Actor) {
  const before = await getCompanyDetails();
  const merged = { ...before, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) } as CompanyDetails;
  const after = alignWithGstin(merged);
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    await prisma.$transaction((tx) => saveSetting(tx, { key: COMPANY_DETAILS_KEY, before, after, actorId: actor.user.id, ip: actor.ip }));
  }
  return getCompanyView();
}

/** The Head only (the route checks). Saved whole; an unchanged list writes nothing. */
export async function updateInvoiceTerms(input: InvoiceTerms, actor: Actor) {
  const before = await getInvoiceTerms();
  if (JSON.stringify(input) !== JSON.stringify(before)) {
    await prisma.$transaction((tx) => saveSetting(tx, { key: INVOICE_TERMS_KEY, before, after: input, actorId: actor.user.id, ip: actor.ip }));
  }
  return getInvoiceTerms();
}

/** A sanity limit for an image: 2 MB (checked in the database too). */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const SIGNATURES: Record<string, Buffer> = {
  "image/png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/jpeg": Buffer.from([0xff, 0xd8, 0xff]),
};

/**
 * Saves a new logo or signature (the Head only; the route checks). It must really be the PNG or JPEG it says it is, and
 * pdf-lib must be able to embed it, because the invoice PDF prints it. The bucket first, then the row and the audit;
 * the object is removed again if the row isn't saved. Older images are kept.
 */
export async function uploadCompanyImage(kindParam: CompanyImageKindParam, contentType: string, bytes: Buffer, actor: Actor) {
  const kind = KIND[kindParam];
  const signature = SIGNATURES[contentType];
  if (!signature) throw badRequest("Upload a PNG or JPEG image.");
  if (bytes.length === 0) throw badRequest("Pick the image to upload.");
  if (!bytes.subarray(0, signature.length).equals(signature)) {
    throw badRequest(`This isn't a ${contentType === "image/png" ? "PNG" : "JPEG"} image. Save it as PNG or JPEG and upload it again.`);
  }
  try {
    const doc = await PDFDocument.create();
    // A plain copy: pdf-lib reads a Buffer's whole backing memory, and a small Buffer shares it with others.
    const data = new Uint8Array(bytes);
    if (contentType === "image/png") await doc.embedPng(data);
    else await doc.embedJpg(data);
  } catch {
    throw badRequest("This image can't be read. Save it again as PNG or JPEG and upload that.");
  }

  const storageKey = `company/${kindParam}/${randomUUID()}.${contentType === "image/png" ? "png" : "jpg"}`;
  await putObject(storageKey, bytes, contentType);
  try {
    await prisma.$transaction(async (tx) => {
      const image = await tx.companyImage.create({
        data: { kind, storageKey, contentType, sizeBytes: bytes.length, uploadedById: actor.user.id },
      });
      await audit(
        {
          actorId: actor.user.id,
          action: "company.image.upload",
          entityType: "CompanyImage",
          entityId: image.id,
          after: { kind, contentType, sizeBytes: bytes.length, storageKey },
          ip: actor.ip,
        },
        tx,
      );
    });
  } catch (err) {
    await deleteObject(storageKey).catch((cleanupErr) => console.error(`Couldn't remove unsaved upload ${storageKey}:`, cleanupErr));
    throw err;
  }
  return getCompanyView();
}

/** A short-lived link to the current image, for the Masters page's preview. */
export async function companyImageLink(kindParam: CompanyImageKindParam) {
  const image = await currentImage(KIND[kindParam]);
  if (!image) throw notFound(`No ${kindParam} uploaded yet.`);
  return presignGet(image.storageKey, { fileName: `masti-${kindParam}.${image.contentType === "image/png" ? "png" : "jpg"}` });
}
