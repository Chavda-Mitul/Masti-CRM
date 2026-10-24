import { degrees, PageSizes, PDFDocument, type PDFImage } from "pdf-lib";
import { badRequest } from "./httpError";
import { jpegOrientation, type ImageType } from "./images";

// Photos on PDF pages: a JPG or PNG on an A4 page of its own, upright, the page turned to suit it. For the scans
// combined into a visa case's saved file (modules/visa/scansPdf.ts, docs/decisions/0008-visa-docket-dispatch.md
// Amendment 1), and for a traveller's file after the decision kept as a PDF (photoToPdf, change request 21 part 2). A
// camera stores a picture as it was taken and says how to turn it (the JPEG's EXIF orientation); PDF viewers ignore
// that, so the picture is turned here.

/**
 * How far a photo is turned to show upright, anticlockwise in degrees: a JPEG's EXIF orientation 3, 6 or 8, as a phone
 * writes it. The mirrored ones (2, 4, 5, 7), which phones and scanners don't write, are drawn as stored.
 */
export function photoTurn(contentType: string, bytes: Buffer) {
  if (contentType !== "image/jpeg") return 0;
  return ({ 3: 180, 6: -90, 8: 90 } as Record<number, number>)[jpegOrientation(bytes)] ?? 0;
}

/** A JPG or PNG embedded in the PDF. Throws when pdf-lib can't read it. */
export function embedPhoto(doc: PDFDocument, bytes: Buffer, contentType: string) {
  // pdf-lib reads a JPEG from the start of its memory, so a Buffer cut from Node's shared pool needs its own copy.
  const own = new Uint8Array(bytes);
  return contentType === "image/png" ? doc.embedPng(own) : doc.embedJpg(own);
}

/** The white edge kept round a photo, in points (about 8 mm). */
const PHOTO_MARGIN = 24;

/**
 * A photo on an A4 page of its own, upright, centred, the page turned to suit it (landscape for a wide photo). It's shrunk
 * to fit inside the margin, never enlarged past one point a pixel.
 */
export function addPhotoPage(doc: PDFDocument, image: PDFImage, turn: number) {
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

/**
 * A JPEG or PNG as a one-page PDF (change request 21 part 2: a photo of a refusal letter, a visa page or an e-visa).
 * Refuses a picture it can't read; its type must have been checked against its first bytes already.
 */
export async function photoToPdf(bytes: Buffer, type: ImageType): Promise<Buffer> {
  const doc = await PDFDocument.create();
  let image: PDFImage;
  try {
    image = await embedPhoto(doc, bytes, type);
  } catch {
    throw badRequest("This photo can't be read. Save it again as a JPEG or PNG and upload that.");
  }
  addPhotoPage(doc, image, photoTurn(type, bytes));
  return Buffer.from(await doc.save());
}
