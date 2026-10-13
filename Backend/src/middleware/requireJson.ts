import type { RequestHandler } from "express";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * JSON, a PDF uploaded as the raw body (the visa file, docs/decisions/0007-visa-file-prep.md Decision 8), and a PNG or
 * JPEG one (Masti's logo and signature, docs/decisions/0009-visa-invoice.md Decision 8).
 */
const ALLOWED = new Set(["application/json", "application/pdf", "image/png", "image/jpeg"]);

/**
 * CSRF protection alongside SameSite=Lax cookies: state-changing requests must declare JSON (or a PDF or image upload).
 * HTML forms on other sites can only send form or text content types, and a cross-site fetch with either of
 * these needs a CORS preflight, which our CORS config rejects for unknown origins.
 * The header is checked directly (not req.is) so body-less POSTs like logout still pass.
 */
export const requireJson: RequestHandler = (req, res, next) => {
  // The media type exactly, before any "; charset=…": "image/pngx" isn't "image/png".
  const contentType = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
  if (MUTATING.has(req.method) && !ALLOWED.has(contentType)) {
    res.status(415).json({ message: "Requests must be sent as JSON." });
    return;
  }
  next();
};
