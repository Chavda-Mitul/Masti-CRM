import { HttpError } from "../../lib/httpError";

// Helpers for partial updates: which fields really changed, and optimistic locking on updatedAt.

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

/** Keeps only the fields whose value differs from the current row. */
export function onlyChanged<T extends object>(changes: T, current: object): Partial<T> {
  const row = current as Record<string, unknown>;
  return Object.fromEntries(Object.entries(changes).filter(([key, value]) => !same(value, row[key]))) as Partial<T>;
}

/** The current values of these fields, for the audit "before". */
export function pick(row: object, keys: string[]): Record<string, unknown> {
  const values = row as Record<string, unknown>;
  return Object.fromEntries(keys.map((key) => [key, values[key]]));
}

/** 409 { code: "STALE" }: someone else saved since this user loaded the record. */
export function staleError(what: string) {
  return new HttpError(409, `Someone else changed this ${what} after you opened it. Reload and try again.`, { code: "STALE" });
}

/** `sent` is the updatedAt the browser read. */
export function assertFresh(current: Date, sent: string, what: string) {
  if (current.getTime() !== new Date(sent).getTime()) throw staleError(what);
}
