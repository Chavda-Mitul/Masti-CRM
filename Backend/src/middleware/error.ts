import type { ErrorRequestHandler, RequestHandler } from "express";
import { z } from "zod";
import { HttpError } from "../lib/httpError";

/** 404 for unknown /api routes. */
export const apiNotFound: RequestHandler = (_req, res) => {
  res.status(404).json({ message: "Not found." });
};

/** Turns thrown errors into JSON responses. Never leaks internals for unexpected errors. */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ message: err.message, ...(err.details ? { details: err.details } : {}) });
    return;
  }

  if (err instanceof z.ZodError) {
    res.status(400).json({ message: "Some fields are missing or invalid.", issues: z.flattenError(err).fieldErrors });
    return;
  }

  // Malformed JSON body from express.json()
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ message: "Request body is not valid JSON." });
    return;
  }

  console.error(err);
  res.status(500).json({ message: "Something went wrong. Please try again." });
};
