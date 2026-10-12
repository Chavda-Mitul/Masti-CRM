import type { RequestHandler } from "express";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** JSON, and a PDF uploaded as the raw body (the visa file, docs/decisions/0007-visa-file-prep.md Decision 8). */
const ALLOWED = ["application/json", "application/pdf"];

/**
 * CSRF protection alongside SameSite=Lax cookies: state-changing requests must declare JSON (or a PDF upload).
 * HTML forms on other sites can only send form or text content types, and a cross-site fetch with either of
 * these needs a CORS preflight, which our CORS config rejects for unknown origins.
 * The header is checked directly (not req.is) so body-less POSTs like logout still pass.
 */
export const requireJson: RequestHandler = (req, res, next) => {
  const contentType = (req.headers["content-type"] ?? "").toLowerCase();
  if (MUTATING.has(req.method) && !ALLOWED.some((type) => contentType.startsWith(type))) {
    res.status(415).json({ message: "Requests must be sent as JSON." });
    return;
  }
  next();
};
