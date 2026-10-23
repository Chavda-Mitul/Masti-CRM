import { crc32, deflateSync } from "node:zlib";

// Images of a chosen size for the upload rules' tests (docs/decisions/0016-client-documents.md Amendment 1). The server
// reads a photo's size from its headers and never decodes the picture.

function pngChunk(type: string, data: Buffer) {
  const typeAndData = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const chunk = Buffer.alloc(8 + data.length + 4);
  chunk.writeUInt32BE(data.length, 0);
  typeAndData.copy(chunk, 4);
  chunk.writeUInt32BE(crc32(typeAndData), 8 + data.length);
  return chunk;
}

/** A real PNG, `width` × `height` pixels of black. */
export function pngOf(width: number, height: number) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 8 bits a pixel, grey (colour type 0).
  const rows = Buffer.alloc((width + 1) * height); // Each row: filter 0, then its pixels.
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * Only the JPEG headers a size is read from: the start, an EXIF block with this orientation (6: shot on its side, shown
 * turned), and a baseline frame header. Not a picture anyone could open.
 */
export function jpegOf(width: number, height: number, orientation?: number) {
  const parts = [Buffer.from([0xff, 0xd8])];
  if (orientation !== undefined) {
    const tiff = Buffer.alloc(26); // Big-endian ("MM"): the header, then one IFD with one entry, 0x0112 = orientation.
    tiff.write("MM", 0, "latin1");
    tiff.writeUInt16BE(42, 2);
    tiff.writeUInt32BE(8, 4);
    tiff.writeUInt16BE(1, 8);
    tiff.writeUInt16BE(0x0112, 10);
    tiff.writeUInt16BE(3, 12); // SHORT
    tiff.writeUInt32BE(1, 14);
    tiff.writeUInt16BE(orientation, 18);
    const exif = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
    const head = Buffer.alloc(4);
    head.writeUInt16BE(0xffe1, 0);
    head.writeUInt16BE(exif.length + 2, 2);
    parts.push(head, exif);
  }
  const frame = Buffer.alloc(19); // SOF0: its length (17), 8-bit samples, the height, the width, 3 components.
  frame.writeUInt16BE(0xffc0, 0);
  frame.writeUInt16BE(17, 2);
  frame[4] = 8;
  frame.writeUInt16BE(height, 5);
  frame.writeUInt16BE(width, 7);
  frame[9] = 3;
  parts.push(frame, Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}

/** The file with zero bytes added at its end, to make it `bytes` long (rounded up): readers stop before them. */
export function padded(file: Buffer, bytes: number) {
  return Buffer.concat([file, Buffer.alloc(Math.max(0, Math.ceil(bytes) - file.length))]);
}
