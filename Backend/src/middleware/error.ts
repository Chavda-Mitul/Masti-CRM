import type { ErrorRequestHandler, RequestHandler } from "express";
import { z } from "zod";
import { AiError } from "../lib/ai/types";
import { HttpError } from "../lib/httpError";

/** 404 for unknown /api routes. */
export const apiNotFound: RequestHandler = (_req, res) => {
  res.status(404).json({ message: "Not found." });
};

/**
 * Turns thrown errors into JSON responses. Never leaks internals for unexpected errors: those go to the server log with
 * their request (src/lib/logger.ts), and the user gets the request's code to quote.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ message: err.message, ...(err.details ? { details: err.details } : {}) });
    return;
  }

  // The AI gave no usable answer (docs/decisions/0023-ai.md): its reason in plain words, and whether trying again may help.
  if (err instanceof AiError) {
    res.status(503).json({ message: err.message, details: { code: "AI_FAILED", retryable: err.retryable } });
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

  res.err = err instanceof Error ? err : new Error(String(err));
  res.status(500).json({ message: `Something went wrong. Please try again. If it keeps happening, quote code ${String(req.id)}.` });
};
