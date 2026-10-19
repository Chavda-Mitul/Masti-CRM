import { prisma, type Db } from "../config/prisma";
import type { Actor } from "../modules/users/user";
import { audit } from "./audit";
import { pick } from "./changes";
import { fieldError } from "./httpError";
import { rethrowUnique } from "./prismaErrors";

// Shared by the admin-editable masters (visa masters, enquiry masters, vendors, covering letters): switched off, never
// deleted; codes never change; every change audited with before/after of the changed fields.

const rethrowCode = rethrowUnique("This code is already used.");

/** `?active=true|false`, or every row. */
export const activeFilter = (active: boolean | undefined) => (active === undefined ? {} : { isActive: active });

/**
 * Countries being added to a record's set (a vendor's, a covering letter's) must exist and be active. One it already
 * has may stay, even if switched off since.
 */
export async function assertCountriesUsable(ids: number[], alreadyCovered: number[] = []) {
  const added = ids.filter((id) => !alreadyCovered.includes(id));
  if (added.length === 0) return;
  const active = await prisma.country.count({ where: { id: { in: added }, isActive: true } });
  if (active !== added.length) throw fieldError("countryIds", "Pick from the active countries.");
}

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
