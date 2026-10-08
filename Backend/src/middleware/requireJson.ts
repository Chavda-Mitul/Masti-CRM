import type { RequestHandler } from "express";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF protection alongside SameSite=Lax cookies: state-changing requests must declare a JSON content type.
 * HTML forms on other sites can only send form or text content types, and a cross-site fetch with
 * application/json needs a CORS preflight, which our CORS config rejects for unknown origins.
 * The header is checked directly (not req.is) so body-less POSTs like logout still pass.
 */
export const requireJson: RequestHandler = (req, res, next) => {
  const contentType = req.headers["content-type"] ?? "";
  if (MUTATING.has(req.method) && !contentType.toLowerCase().startsWith("application/json")) {
    res.status(415).json({ message: "Requests must be sent as JSON." });
    return;
  }
  next();
};
