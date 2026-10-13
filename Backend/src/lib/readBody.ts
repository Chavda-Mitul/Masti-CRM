import type { Request } from "express";
import { HttpError } from "./httpError";

/**
 * Reads a raw request body (an uploaded file) into memory, up to `maxBytes`. A bigger body is read to the end without
 * being kept, so the browser gets the 413 instead of a dropped connection, then refused.
 */
export function readBody(req: Request, maxBytes: number, tooBig: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        over = true;
        chunks.length = 0;
      }
      if (!over) chunks.push(chunk);
    });
    req.on("end", () => (over ? reject(new HttpError(413, tooBig)) : resolve(Buffer.concat(chunks, size))));
    req.on("error", reject);
    req.on("aborted", () => reject(new HttpError(400, "The upload was interrupted. Please try again.")));
  });
}
