import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { photoToPdf, photoTurn } from "../src/lib/photoPdf";
import { jpegOf, pngOf } from "./imageFiles";

// A photo kept as a PDF (lib/photoPdf.ts, change request 21 part 2): one A4 page shaped like the picture as it shows,
// the picture turned upright from its EXIF orientation, which PDF viewers ignore. The same page the scans combined into
// a case's saved file use (0008 Amendment 1).

describe("how far a photo is turned", () => {
  it("follows a JPEG's EXIF orientation 3, 6 or 8; draws the rest, and a PNG, as stored", () => {
    expect(photoTurn("image/jpeg", jpegOf(40, 30))).toBe(0);
    expect(photoTurn("image/jpeg", jpegOf(40, 30, 3))).toBe(180);
    expect(photoTurn("image/jpeg", jpegOf(40, 30, 6))).toBe(-90);
    expect(photoTurn("image/jpeg", jpegOf(40, 30, 8))).toBe(90);
    expect(photoTurn("image/jpeg", jpegOf(40, 30, 5))).toBe(0);
    expect(photoTurn("image/png", pngOf(40, 30))).toBe(0);
  });
});

describe("photoToPdf", () => {
  const pageOf = async (pdf: Buffer) => {
    const doc = await PDFDocument.load(pdf);
    return { pages: doc.getPageCount(), ...doc.getPage(0).getSize() };
  };

  it("makes one A4 page: landscape for a wide photo, portrait for a tall one or one shot on its side", async () => {
    expect(await pageOf(await photoToPdf(jpegOf(400, 300), "image/jpeg"))).toEqual({ pages: 1, width: 841.89, height: 595.28 });
    // Stored 400 × 300 and shown turned a quarter (EXIF 6): 300 × 400 as it shows.
    expect(await pageOf(await photoToPdf(jpegOf(400, 300, 6), "image/jpeg"))).toEqual({ pages: 1, width: 595.28, height: 841.89 });
    expect(await pageOf(await photoToPdf(pngOf(30, 40), "image/png"))).toEqual({ pages: 1, width: 595.28, height: 841.89 });
  });

  it("refuses a picture it can't read", async () => {
    await expect(photoToPdf(Buffer.from([0xff, 0xd8, 0xff, 0x00]), "image/jpeg")).rejects.toThrow(/can't be read/);
  });
});
