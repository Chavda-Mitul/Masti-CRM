import type { Prisma } from "../../generated/prisma/client";
import { prisma, type Db } from "../config/prisma";

export interface AuditEntry {
  actorId?: string | null;
  /** Dotted verb, e.g. "auth.login.success", "user.create", "user.deactivate". */
  action: string;
  entityType: string;
  entityId?: string | null;
  /** The client this change belongs to (the client itself, or one of its numbers, members, notes, later its files), for a client's history. */
  clientId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

// secret, loginId and ticket: a portal login's sealed secret, its ID and a Log in for me ticket (0024), as a safety net;
// portal snapshots leave them out anyway.
const SECRET_KEYS = new Set([
  "passwordHash",
  "tokenHash",
  "password",
  "newPassword",
  "currentPassword",
  "tempPassword",
  "secret",
  "loginId",
  "ticket",
]);

/** JSON-safe copy without secrets. Dates become ISO strings, BigInts become strings. */
function snapshot(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  const json = JSON.stringify(value, (key, v: unknown) => {
    if (SECRET_KEYS.has(key)) return undefined;
    if (typeof v === "bigint") return v.toString();
    return v;
  });
  return JSON.parse(json) as Prisma.InputJsonValue;
}

/**
 * Append an entry to the audit log (append-only; the database blocks UPDATE/DELETE).
 * Pass the transaction client when the audited change happens inside a transaction.
 */
export async function audit(entry: AuditEntry, db: Db = prisma): Promise<void> {
  await db.auditLog.create({ data: rowOf(entry) });
}

/** Several entries in one insert, e.g. one per case when a whole docket is dispatched. */
export async function auditMany(entries: AuditEntry[], db: Db = prisma): Promise<void> {
  if (entries.length) await db.auditLog.createMany({ data: entries.map(rowOf) });
}

function rowOf(entry: AuditEntry) {
  const before = snapshot(entry.before);
  const after = snapshot(entry.after);
  return {
    action: entry.action,
    entityType: entry.entityType,
    actorId: entry.actorId ?? null,
    entityId: entry.entityId ?? null,
    clientId: entry.clientId ?? null,
    ip: entry.ip ?? null,
    ...(before !== undefined ? { before } : {}),
    ...(after !== undefined ? { after } : {}),
  };
}
