import { badRequest, HttpError } from "../../lib/httpError";
import { imageType } from "../../lib/images";
import { MB, pdfPageCount } from "../../lib/pdf";
import { photoToPdf } from "../../lib/photoPdf";
import type { ScanType } from "../clients/clients.schemas";

// A traveller's file after the decision (docs/decisions/0012-visa-decision.md, amended 24 Oct 2026, change request 21,
// part 2): the refusal letter, the visa copy or the e-visa. Uploaded as a scanner's PDF or a phone's JPEG or PNG, and
// always kept as a PDF: a photo becomes one upright A4 page (lib/photoPdf.ts). Part 3 sends these files to the client
// on WhatsApp, hence one limit for all three.

/**
 * The largest such file ⚠️: WhatsApp's own limit on a file (Twilio gives 20 MB), with room to spare, or the final
 * file's limit (visa.finalFile.maxMb) when that's lower.
 */
export function decisionFileMaxMb(finalFileMaxMb: number) {
  return Math.min(finalFileMaxMb, 16);
}

/** What a too-big upload is told, before it's read. */
export function decisionFileLimit(finalFileMaxMb: number) {
  const maxMb = decisionFileMaxMb(finalFileMaxMb);
  return { maxBytes: maxMb * MB, tooBig: `This file is over ${maxMb} MB. Scan it at a lower resolution and upload it again.` };
}

/**
 * The upload as the PDF the CRM keeps, with its pages, and the photo's type when it was a photo. A PDF must be a real
 * one (pdfPageCount); a photo must really be the type it was sent as, and the PDF it makes must still fit the limit: a
 * PNG can grow.
 */
export async function travellerFilePdf(bytes: Buffer, contentType: ScanType, finalFileMaxMb: number) {
  if (contentType === "application/pdf") return { pdf: bytes, pageCount: await pdfPageCount(bytes), photo: null };
  if (bytes.length === 0) throw badRequest("Pick the file to upload.");
  const type = contentType === "image/png" ? "PNG" : "JPEG";
  if (imageType(bytes) !== contentType) throw badRequest(`This isn't a ${type}. Save it again as a PDF, JPEG or PNG and upload that.`);
  const pdf = await photoToPdf(bytes, contentType);
  const maxMb = decisionFileMaxMb(finalFileMaxMb);
  if (pdf.length > maxMb * MB) throw new HttpError(413, `This photo makes a PDF over ${maxMb} MB. Take it at a lower resolution and upload it again.`);
  return { pdf, pageCount: 1, photo: contentType };
}
