// The image types the CRM stores (Masti's logo and signature, a receiver's photo at handover) or turns into a PDF (a
// photo of a refusal letter or visa page, lib/photoPdf.ts), told by their first bytes rather than by what the upload
// says it is.

const SIGNATURES = {
  "image/png": Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/jpeg": Buffer.from([0xff, 0xd8, 0xff]),
} as const;

export type ImageType = keyof typeof SIGNATURES;

/** Is this content type one of ours (PNG or JPEG)? */
export function isImageType(contentType: string): contentType is ImageType {
  return Object.hasOwn(SIGNATURES, contentType);
}

/** What the bytes really are: a PNG, a JPEG, or neither (null). */
export function imageType(bytes: Buffer): ImageType | null {
  for (const [type, signature] of Object.entries(SIGNATURES)) {
    if (bytes.length >= signature.length && bytes.subarray(0, signature.length).equals(signature)) return type as ImageType;
  }
  return null;
}

/**
 * A PNG's or JPEG's size in pixels as it shows: a phone photo turned on its side (its EXIF rotation) counts turned.
 * Read from the file's headers, without decoding the picture. Null when the headers don't say.
 */
export function imageSize(bytes: Buffer, type: ImageType): { width: number; height: number } | null {
  return type === "image/png" ? pngSize(bytes) : jpegSize(bytes);
}

/** After the 8-byte signature comes the IHDR chunk: its length (4), "IHDR" (4), the width (4) and the height (4). */
function pngSize(bytes: Buffer) {
  if (bytes.length < 24 || bytes.toString("latin1", 12, 16) !== "IHDR") return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** The frame headers that carry a JPEG's size (baseline, progressive…); C4, C8 and CC are other markers. */
const FRAME_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** A JPEG's size as it shows: turned a quarter (EXIF orientation 5–8), its width and height swap. */
function jpegSize(bytes: Buffer) {
  const headers = jpegHeaders(bytes);
  if (!headers) return null;
  const { width, height, orientation } = headers;
  return orientation >= 5 ? { width: height, height: width } : { width, height };
}

/**
 * A JPEG's EXIF orientation, 1–8: how the camera stored the picture against how it shows (6: turn it a quarter
 * clockwise to show it). 1, as stored, when the file doesn't say. PDF viewers ignore it, so a photo kept as a PDF is
 * turned by it (lib/photoPdf.ts).
 */
export function jpegOrientation(bytes: Buffer): number {
  return jpegHeaders(bytes)?.orientation ?? 1;
}

/** Walks the JPEG's segments to its frame header: its size as stored, and the EXIF orientation that comes before it. */
function jpegHeaders(bytes: Buffer) {
  let orientation = 1;
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1]!;
    if (marker === 0xff) {
      at += 1; // A fill byte.
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2; // Markers with no length.
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // The end, or the picture itself, before any size.
    const length = bytes.readUInt16BE(at + 2);
    if (length < 2 || at + 2 + length > bytes.length) return null;
    if (marker === 0xe1 && orientation === 1) orientation = exifOrientation(bytes.subarray(at + 4, at + 2 + length));
    if (FRAME_MARKERS.has(marker)) {
      if (length < 7) return null;
      const height = bytes.readUInt16BE(at + 5);
      const width = bytes.readUInt16BE(at + 7);
      if (width === 0 || height === 0) return null;
      return { width, height, orientation };
    }
    at += 2 + length;
  }
  return null;
}

/** The EXIF orientation (1–8) this APP1 block gives, or 1 when it gives none. */
function exifOrientation(app1: Buffer) {
  if (app1.length < 14 || app1.toString("latin1", 0, 6) !== "Exif\0\0") return 1;
  const tiff = app1.subarray(6);
  const order = tiff.toString("latin1", 0, 2);
  if (order !== "II" && order !== "MM") return 1;
  const u16 = (at: number) => (order === "II" ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at));
  const first = order === "II" ? tiff.readUInt32LE(4) : tiff.readUInt32BE(4);
  if (first + 2 > tiff.length) return 1;
  for (let entry = first + 2, n = u16(first); n > 0 && entry + 12 <= tiff.length; n--, entry += 12) {
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}
