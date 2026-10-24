import { concatTransformationMatrix, drawObject, PDFDocument, popGraphicsState, pushGraphicsState } from "pdf-lib";
import { badRequest } from "./httpError";
import { imageSize, jpegOrientation, type ImageType } from "./images";

// A photo kept as a PDF (docs/decisions/0012-visa-decision.md, amended 24 Oct 2026, change request 21): a phone's
// picture of a refusal letter, a visa page or an e-visa becomes one A4 page, portrait or landscape to match the picture
// as it shows, the picture fitted inside a small margin. A camera stores a picture as it was taken and says how to turn
// it (the JPEG's EXIF orientation); PDF viewers ignore that, so the picture is turned upright here.

/** A4 in points. */
const A4 = { long: 841.89, short: 595.28 };
/** Around the picture ⚠️, so a printer's edge doesn't cut it. */
const MARGIN = 24;

type Matrix = [number, number, number, number, number, number];

/**
 * Where the stored picture goes so it shows upright in the box (x, y, w, h), as EXIF orientation `o` says. A PDF draws
 * a picture into a unit square whose (0, 1) corner is the picture's top-left as stored; the matrix places that square:
 * X = a·u + c·v + e, Y = b·u + d·v + f.
 */
export function orientationMatrix(o: number, x: number, y: number, w: number, h: number): Matrix {
  switch (o) {
    case 2: // mirrored left to right
      return [-w, 0, 0, h, x + w, y];
    case 3: // a half turn
      return [-w, 0, 0, -h, x + w, y + h];
    case 4: // mirrored top to bottom
      return [w, 0, 0, -h, x, y + h];
    case 5: // mirrored along the top-left diagonal
      return [0, -h, -w, 0, x + w, y + h];
    case 6: // a quarter turn clockwise
      return [0, -h, w, 0, x, y + h];
    case 7: // mirrored along the top-right diagonal
      return [0, h, w, 0, x, y];
    case 8: // a quarter turn anticlockwise
      return [0, h, -w, 0, x + w, y];
    default: // as stored
      return [w, 0, 0, h, x, y];
  }
}

/**
 * A JPEG or PNG as a one-page PDF, the picture upright and as large as A4 allows. Refuses a picture that can't be read:
 * its type must have been checked against its first bytes already.
 */
export async function photoToPdf(bytes: Buffer, type: ImageType): Promise<Buffer> {
  const shows = imageSize(bytes, type);
  if (!shows) throw badRequest("This photo can't be read. Save it again as a JPEG or PNG and upload that.");
  const doc = await PDFDocument.create();
  let picture;
  try {
    // A copy: pdf-lib reads the whole memory behind the bytes, which for a Buffer can hold other data too.
    const data = new Uint8Array(bytes);
    picture = type === "image/png" ? await doc.embedPng(data) : await doc.embedJpg(data);
  } catch {
    throw badRequest("This photo can't be read. Save it again as a JPEG or PNG and upload that.");
  }
  const landscape = shows.width > shows.height;
  const page = doc.addPage(landscape ? [A4.long, A4.short] : [A4.short, A4.long]);
  const room = { width: page.getWidth() - 2 * MARGIN, height: page.getHeight() - 2 * MARGIN };
  const scale = Math.min(room.width / shows.width, room.height / shows.height);
  const w = shows.width * scale;
  const h = shows.height * scale;
  const x = (page.getWidth() - w) / 2;
  const y = (page.getHeight() - h) / 2;
  const orientation = type === "image/jpeg" ? jpegOrientation(bytes) : 1;
  const name = page.node.newXObject("Image", picture.ref);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...orientationMatrix(orientation, x, y, w, h)), drawObject(name), popGraphicsState());
  return Buffer.from(await doc.save());
}
