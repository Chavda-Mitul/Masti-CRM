import { Prisma } from "../../generated/prisma/client";
import { conflict } from "./httpError";

/** A unique-constraint violation (Prisma P2002). */
export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * For `.catch(...)` on a write: turns a unique-constraint violation into a 409 with this message.
 * The fallback when two requests race past the service's own duplicate checks.
 */
export function rethrowUnique(message: string) {
  return (err: unknown): never => {
    if (isUniqueViolation(err)) throw conflict(message);
    throw err;
  };
}
