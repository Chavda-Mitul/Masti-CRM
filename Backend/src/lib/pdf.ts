import { PDFDocument } from "pdf-lib";
import { badRequest } from "./httpError";

// Scanned PDFs: a visa case's final file (docs/decisions/0007-visa-file-prep.md Decision 8) and a refused traveller's
// refusal letter (docs/decisions/0012-visa-decision.md Decision 4), and scans in the client document vault
// (docs/decisions/0016-client-documents.md).

export const MB = 1024 * 1024;
const PDF_MAGIC = Buffer.from("%PDF-");

/** The upload's page count, once it's sure to be a real PDF: it starts with %PDF-, opens, and has pages. */
export async function pdfPageCount(bytes: Buffer) {
  if (bytes.length === 0) throw badRequest("Pick the PDF to upload.");
  if (!bytes.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) throw badRequest("This isn't a PDF. Save the scan as a PDF and upload that.");
  let pageCount: number;
  try {
    pageCount = (await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })).getPageCount();
  } catch {
    throw badRequest("This PDF can't be opened. Save it again and upload the new copy.");
  }
  if (pageCount === 0) throw badRequest("This PDF has no pages.");
  return pageCount;
}

/** What a too-big upload is told, with the limit in MB (the setting visa.finalFile.maxMb). */
export const tooBigMessage = (maxMb: number) => `This PDF is over ${maxMb} MB. Scan it at a lower resolution and upload it again.`;
