import { prisma, type Db } from "../config/prisma";
import type { Actor } from "../modules/users/user";
import { audit } from "./audit";
import { pick } from "./changes";
import { rethrowUnique } from "./prismaErrors";

// Shared by the admin-editable masters (visa masters, enquiry masters): switched off, never deleted; codes never
// change; every change audited with before/after of the changed fields.

const rethrowCode = rethrowUnique("This code is already used.");

/** `?active=true|false`, or every row. */
export const activeFilter = (active: boolean | undefined) => (active === undefined ? {} : { isActive: active });

interface SaveOptions<Row> {
  before: Row;
  changes: object;
  actor: Actor;
  action: string;
  entityType: string;
  entityId: string | number;
  write: (tx: Db) => Promise<Row>;
}

/** Writes only real changes, audited in the same transaction. Returns the current row either way. */
export async function saveChanges<Row extends object>({ before, changes, actor, action, entityType, entityId, write }: SaveOptions<Row>) {
  const keys = Object.keys(changes);
  if (keys.length === 0) return before;
  return prisma.$transaction(async (tx) => {
    const after = await write(tx);
    await audit(
      { actorId: actor.user.id, action, entityType, entityId: String(entityId), before: pick(before, keys), after: pick(after, keys), ip: actor.ip },
      tx,
    );
    return after;
  });
}

/** Creates a row and audits it in one transaction. A duplicate code is a 409. */
export async function createAudited<Row extends { id: number }>(actor: Actor, action: string, entityType: string, create: (tx: Db) => Promise<Row>) {
  return prisma
    .$transaction(async (tx) => {
      const row = await create(tx);
      await audit({ actorId: actor.user.id, action, entityType, entityId: String(row.id), after: row, ip: actor.ip }, tx);
      return row;
    })
    .catch(rethrowCode);
}
