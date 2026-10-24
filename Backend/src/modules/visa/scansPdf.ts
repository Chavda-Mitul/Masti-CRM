import { degrees, PageSizes, PDFDocument, type PDFImage } from "pdf-lib";
import type { DocumentStatus, ReceivedAs } from "../../../generated/prisma/enums";
import { badRequest, HttpError } from "../../lib/httpError";
import { jpegOrientation } from "../../lib/images";
import { logger } from "../../lib/logger";
import { scanKey, type CurrentScans } from "../clients/clientDocuments.service";

// The case's scans combined into its saved file at Docket & dispatch (docs/decisions/0008-visa-docket-dispatch.md
// Amendment 1): which scan each paper goes in with, what's missing, and the PDF itself. The case page (visaCase.ts) and
// the combining (visaCombineScans.service.ts) both ask scansForFile, so the card never promises what the job refuses.

/** A paper on a traveller's checklist, as scansForFile reads it. */
export interface PaperScanRow {
  name: string;
  documentId: number;
  status: DocumentStatus;
  receivedAs: ReceivedAs | null;
  clientDocumentId: string | null;
}

/** A traveller: how the missing list names them, the family member their scans are kept under, their papers in order. */
export interface TravellerScanRow {
  label: string;
  memberId: string | null;
  documents: PaperScanRow[];
}

/** A paper's scan, in page order. */
export interface FoundScan {
  traveller: string;
  paper: string;
  scanId: string;
}

/** One traveller's papers with no scan: "Rakesh Mehta: Bank statement, PAN card". */
export interface MissingScans {
  traveller: string;
  papers: string[];
}

/**
 * Every paper that came in needs a scan from this case, in the travellers' order and then the checklist's. Papers we
 * arrange (Made), Not needed and still Pending ones are left out: there's nothing to scan. `found` is empty when no
 * paper came in.
 */
export function scansForFile(travellers: TravellerScanRow[], current: CurrentScans, caseCreatedAt: Date) {
  const found: FoundScan[] = [];
  const missing: MissingScans[] = [];
  for (const t of travellers) {
    const lacking: string[] = [];
    for (const d of t.documents) {
      if (d.status !== "RECEIVED") continue;
      const scanId = scanOfPaper(d, t.memberId, current, caseCreatedAt);
      if (scanId) found.push({ traveller: t.label, paper: d.name, scanId });
      else lacking.push(d.name);
    }
    if (lacking.length > 0) missing.push({ traveller: t.label, papers: lacking });
  }
  return { found, missing };
}

/**
 * An On file paper goes in with the copy it was printed from. An Original or a Xerox goes in with the traveller's current
 * scan of it, if that was saved since the case was opened: a copy from an earlier trip doesn't count, as for "Scan not
 * saved" (0016 Decision 7). An unnamed traveller has no scans. Null when there's none.
 */
function scanOfPaper(d: PaperScanRow, memberId: string | null, current: CurrentScans, since: Date) {
  if (d.receivedAs === "ON_FILE") return d.clientDocumentId;
  const scan = memberId ? current.get(scanKey(memberId, d.documentId)) : undefined;
  return scan && scan.uploadedAt >= since ? scan.id : null;
}

/** "2 scans missing — Rakesh Mehta: Bank statement; Aarav Mehta: Passport" */
export function missingScansText(missing: MissingScans[]) {
  const count = missing.reduce((n, m) => n + m.papers.length, 0);
  return `${count} ${count === 1 ? "scan" : "scans"} missing — ${missing.map((m) => `${m.traveller}: ${m.papers.join(", ")}`).join("; ")}`;
}

/** One scan to put in the file: whose paper it is for the messages ("Rakesh Mehta's Passport"), its type, its bytes. */
export interface ScanSource {
  what: string;
  contentType: string;
  /** Fetched when its turn comes, so only one scan is held in memory besides the file. */
  load: () => Promise<Buffer>;
}

/**
 * The scans as one PDF, in the order given: a PDF scan's pages as they are, a JPG or PNG on a page of its own. A scan
 * that can't be opened (or a password-protected PDF) is refused with a 400 naming it; the bucket's own errors pass on.
 */
export async function scansPdf(scans: ScanSource[], title: string) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setCreator("Masti CRM");
  for (const scan of scans) {
    const bytes = await scan.load();
    try {
      if (scan.contentType === "application/pdf") await addPdfPages(doc, bytes, scan.what);
      else {
        // pdf-lib reads a JPEG from the start of its memory, so a Buffer cut from Node's shared pool needs its own copy.
        const own = new Uint8Array(bytes);
        addPhotoPage(doc, scan.contentType === "image/png" ? await doc.embedPng(own) : await doc.embedJpg(own), scanTurn(scan.contentType, bytes));
      }
    } catch (err) {
      if (err instanceof HttpError) throw err;
      logger.warn({ err, scan: scan.what }, "A scan couldn't be put in the combined file.");
      throw badRequest(`${scan.what} can't be opened, so the scans can't be combined.`);
    }
  }
  return { bytes: Buffer.from(await doc.save()), pageCount: doc.getPageCount() };
}

/**
 * Every page of a PDF scan, as it is. A password-protected one is refused: its pages would come out unreadable. (It's
 * opened with ignoreEncryption and asked, because pdf-lib's own EncryptedPDFError doesn't survive `instanceof`.) One
 * with no pages throws.
 */
async function addPdfPages(doc: PDFDocument, bytes: Buffer, what: string) {
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  if (source.isEncrypted) throw badRequest(`${what} is password-protected, so the scans can't be combined.`);
  if (source.getPageCount() === 0) throw new Error("The PDF has no pages.");
  for (const page of await doc.copyPages(source, source.getPageIndices())) doc.addPage(page);
}

/**
 * How far a photo is turned to show upright, anticlockwise in degrees: a JPEG's EXIF orientation 3, 6 or 8, as a phone
 * writes it. The mirrored ones (2, 4, 5, 7), which phones and scanners don't write, are drawn as stored.
 */
function scanTurn(contentType: string, bytes: Buffer) {
  if (contentType !== "image/jpeg") return 0;
  return ({ 3: 180, 6: -90, 8: 90 } as Record<number, number>)[jpegOrientation(bytes)] ?? 0;
}

/** The white edge kept round a photo, in points (about 8 mm). */
const PHOTO_MARGIN = 24;

/**
 * A photo on an A4 page of its own, upright, centred, the page turned to suit it (landscape for a wide photo). It's shrunk
 * to fit inside the margin, never enlarged past one point a pixel.
 */
function addPhotoPage(doc: PDFDocument, image: PDFImage, turn: number) {
  const quarter = turn === 90 || turn === -90;
  const shownWidth = quarter ? image.height : image.width;
  const shownHeight = quarter ? image.width : image.height;
  const [short, long] = PageSizes.A4;
  const page = doc.addPage(shownWidth > shownHeight ? [long, short] : [short, long]);
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const scale = Math.min(1, (pageWidth - 2 * PHOTO_MARGIN) / shownWidth, (pageHeight - 2 * PHOTO_MARGIN) / shownHeight);
  const boxWidth = shownWidth * scale;
  const boxHeight = shownHeight * scale;
  const left = (pageWidth - boxWidth) / 2;
  const bottom = (pageHeight - boxHeight) / 2;
  // The picture turns about its own bottom-left corner, so that corner moves for the turned picture to fill the box.
  const corner =
    turn === 90
      ? { x: left + boxWidth, y: bottom }
      : turn === -90
        ? { x: left, y: bottom + boxHeight }
        : turn === 180
          ? { x: left + boxWidth, y: bottom + boxHeight }
          : { x: left, y: bottom };
  page.drawImage(image, { ...corner, width: image.width * scale, height: image.height * scale, rotate: degrees(turn) });
}
