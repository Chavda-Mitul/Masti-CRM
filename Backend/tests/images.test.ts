import { describe, expect, it } from "vitest";
import { imageSize, imageType, jpegOrientation } from "../src/lib/images";
import { jpegOf, pngOf } from "./imageFiles";

// A photo's size in pixels, read from its headers, for a paper's photo shape (docs/decisions/0016-client-documents.md
// Amendment 1).

/** The real 1×1 JPEG clientDocuments.test.ts and company.test.ts upload. */
const REAL_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);

describe("imageSize", () => {
  it("reads a PNG's size from its header", () => {
    const png = pngOf(413, 531);
    expect(imageType(png)).toBe("image/png");
    expect(imageSize(png, "image/png")).toEqual({ width: 413, height: 531 });
  });

  it("reads a JPEG's size from its frame header, past the segments before it", () => {
    expect(imageSize(REAL_JPEG, "image/jpeg")).toEqual({ width: 1, height: 1 });
    expect(imageSize(jpegOf(600, 800), "image/jpeg")).toEqual({ width: 600, height: 800 });
  });

  it("turns a phone photo shot on its side (EXIF orientation 5–8), as it shows", () => {
    expect(imageSize(jpegOf(900, 700, 6), "image/jpeg")).toEqual({ width: 700, height: 900 });
    expect(imageSize(jpegOf(900, 700, 8), "image/jpeg")).toEqual({ width: 700, height: 900 });
    expect(imageSize(jpegOf(900, 700, 1), "image/jpeg")).toEqual({ width: 900, height: 700 });
    expect(imageSize(jpegOf(900, 700, 3), "image/jpeg")).toEqual({ width: 900, height: 700 }); // Upside down: same shape.
  });

  it("says null when the headers don't give a size", () => {
    expect(imageSize(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), "image/jpeg")).toBeNull();
    expect(imageSize(jpegOf(600, 800).subarray(0, 8), "image/jpeg")).toBeNull();
    expect(imageSize(Buffer.from("not a picture at all, just text"), "image/png")).toBeNull();
    expect(imageSize(pngOf(10, 10).subarray(0, 20), "image/png")).toBeNull();
    expect(imageSize(jpegOf(0, 800), "image/jpeg")).toBeNull();
  });
});

// How a photo is turned upright when it's put on a page (the scans combined into a visa case's saved file,
// docs/decisions/0008-visa-docket-dispatch.md Amendment 1).
describe("jpegOrientation", () => {
  it("gives the EXIF orientation, or 1 when there's none or it's not one of 1–8", () => {
    expect(jpegOrientation(jpegOf(900, 700, 6))).toBe(6);
    expect(jpegOrientation(jpegOf(900, 700, 3))).toBe(3);
    expect(jpegOrientation(jpegOf(900, 700, 8))).toBe(8);
    expect(jpegOrientation(jpegOf(900, 700))).toBe(1);
    expect(jpegOrientation(REAL_JPEG)).toBe(1);
    expect(jpegOrientation(jpegOf(900, 700, 9))).toBe(1);
    expect(imageSize(jpegOf(900, 700, 9), "image/jpeg")).toEqual({ width: 900, height: 700 });
  });
});
