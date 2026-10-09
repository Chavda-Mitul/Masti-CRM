import { z } from "zod";

/** An error with an HTTP status. Thrown from routes and middleware, turned into a JSON response by errorHandler. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);
export const unauthorized = (message = "Please log in.") => new HttpError(401, message);
export const forbidden = (message = "You don't have access to this.") => new HttpError(403, message);
export const notFound = (message = "Not found.") => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);

/**
 * A 400 for one form field, in the same shape as a zod validation error ({ message, issues: { field: [message] } }),
 * so the frontend shows it next to that input. For rules the request schema can't see (e.g. the stored row's state).
 */
export function fieldError(field: string, message: string) {
  return new z.ZodError([{ code: "custom", path: [field], message, input: undefined }]);
}
