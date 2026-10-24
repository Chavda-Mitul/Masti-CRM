import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { orientationMatrix, photoToPdf } from "../src/lib/photoPdf";
import { jpegOf, pngOf } from "./imageFiles";

// A photo kept as a PDF (lib/photoPdf.ts, change request 21 part 2): one A4 page shaped like the picture as it shows,
// the picture turned upright from its EXIF orientation, which PDF viewers ignore.

/** Where a matrix [a b c d e f] puts the point (u, v) of the picture's unit square. */
const at = (m: number[], u: number, v: number) => [m[0]! * u + m[2]! * v + m[4]!, m[1]! * u + m[3]! * v + m[5]!];

describe("the picture turned upright", () => {
  // The box: x 10, y 20, 100 wide, 50 high, and its corners as they show.
  const TL = [10, 70];
  const TR = [110, 70];
  const BL = [10, 20];
  const BR = [110, 20];
  // Where the stored picture's top-left (0, 1), top-right (1, 1) and bottom-left (0, 0) must show, per EXIF orientation.
  const cases: [number, number[], number[], number[]][] = [
    [1, TL, TR, BL],
    [2, TR, TL, BR],
    [3, BR, BL, TR],
    [4, BL, BR, TL],
    [5, TL, BL, TR],
    [6, TR, BR, TL],
    [7, BR, TR, BL],
    [8, BL, TL, BR],
  ];
  it.each(cases)("EXIF orientation %i", (orientation, topLeft, topRight, bottomLeft) => {
    const m = orientationMatrix(orientation, 10, 20, 100, 50);
    expect(at(m, 0, 1)).toEqual(topLeft);
    expect(at(m, 1, 1)).toEqual(topRight);
    expect(at(m, 0, 0)).toEqual(bottomLeft);
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
