import { randomUUID } from "node:crypto";
import { env } from "../../config/env";
import { prisma } from "../../config/prisma";
import { audit, auditMany } from "../../lib/audit";
import { assertFresh, staleError } from "../../lib/changes";
import { badRequest, fieldError, forbidden, HttpError, notFound } from "../../lib/httpError";
import { logger } from "../../lib/logger";
import { rethrowUnique } from "../../lib/prismaErrors";
import { openSecret, sealSecret, SecretUnreadableError, VaultKeyMissingError, vaultReady } from "../../lib/secretBox";
import { getOfficeNetworkSetting } from "../auth/officeNetwork";
import type { Actor, UserWithDepartments } from "../users/user";
import {
  canManagePortal,
  canUsePortal,
  portalLoginInclude,
  portalLoginSnapshot,
  secretLabel,
  toPortalLoginDto,
  type PortalSecret,
} from "./portalLogin";
import type { CreatePortalLoginInput, UpdatePortalLoginInput } from "./portalLogins.schemas";

// Settings → Portal logins (docs/decisions/0024-portal-logins.md, demo screen 28). The Head and a department's HOD add,
// change and remove its portals; staff see the portals they're on the list for. The ID and password are sealed under
// PORTAL_VAULT_KEY and never sent to a CRM page. Removing a portal wipes them and keeps the row; every change is audited.

/** How many presses "Who used what" shows. */
const RECENT_USES = 10;

export const notSetUp = () => new HttpError(503, "Portal logins aren't set up on this server yet.", { code: "VAULT_MISSING" });

const unreadable = () =>
  new HttpError(409, "This portal's saved login can't be read. Ask your HOD to type the ID and password again.", { code: "UNREADABLE" });

/** The sealed bytes, as Prisma takes them. */
function seal(secret: PortalSecret, portalLoginId: string): Uint8Array<ArrayBuffer> {
  try {
    return new Uint8Array(sealSecret(secret, secretLabel(portalLoginId)));
  } catch (err) {
    if (err instanceof VaultKeyMissingError) throw notSetUp();
    throw err;
  }
}

/** A portal's ID and password, or a plain answer when they can't be read (no key here, or a different key). */
export function openPortalSecret(row: { id: string; secret: Uint8Array | null }): PortalSecret {
  if (!row.secret) throw badRequest("This portal was removed.");
  try {
    return openSecret<PortalSecret>(row.secret, secretLabel(row.id));
  } catch (err) {
    if (err instanceof VaultKeyMissingError) throw notSetUp();
    if (err instanceof SecretUnreadableError) {
      logger.error({ portalLoginId: row.id }, "A portal login's secret can't be opened with PORTAL_VAULT_KEY");
      throw unreadable();
    }
    throw err;
  }
}

async function loadOr404(id: string) {
  const row = await prisma.portalLogin.findUnique({ where: { id }, include: portalLoginInclude });
  if (!row) throw notFound("Portal not found.");
  return row;
}

/** The active departments whose portals this user manages, in the sidebar's order. */
async function managedDepartments(user: UserWithDepartments) {
  const departments = await prisma.department.findMany({ where: { isActive: true }, select: { code: true, name: true }, orderBy: { sortOrder: "asc" } });
  return departments.filter((d) => canManagePortal(user, d.code));
}

/** "Who used what": the last logins the helper collected, in these departments, newest first, with the case if any. */
async function recentUses(departmentCodes: string[]) {
  const rows = await prisma.portalLoginUse.findMany({
    where: { redeemedAt: { not: null }, portalLogin: { department: { code: { in: departmentCodes } } } },
    orderBy: [{ redeemedAt: "desc" }, { id: "desc" }],
    take: RECENT_USES,
    include: {
      user: { select: { id: true, name: true } },
      portalLogin: { select: { id: true, name: true } },
      enquiry: { select: { caseNo: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    user: r.user,
    portal: r.portalLogin,
    caseNo: r.enquiry?.caseNo ?? null,
    at: r.redeemedAt,
    outcome: r.outcome,
  }));
}

/**
 * The page: the portals this person may see (all of a department's for its HOD and the Head; staff only those they're
 * listed on), the last presses for those who manage portals, and what the page needs to know.
 */
export async function listPortalLogins(user: UserWithDepartments) {
  const rows = await prisma.portalLogin.findMany({
    where: { status: "ACTIVE", department: { isActive: true } },
    include: portalLoginInclude,
    orderBy: [{ department: { sortOrder: "asc" } }, { name: "asc" }],
  });
  const managed = await managedDepartments(user);
  const { allow } = await getOfficeNetworkSetting();
  return {
    portals: rows.filter((row) => canManagePortal(user, row.department.code) || canUsePortal(user, row)).map((row) => toPortalLoginDto(row, user)),
    uses: managed.length > 0 ? await recentUses(managed.map((d) => d.code)) : [],
    /** The departments this person may add portals to. */
    addTo: managed,
    /** No office addresses yet (M19): Log in for me works from anywhere until there are. */
    officeAddressesSet: allow.length > 0,
    /** PORTAL_VAULT_KEY is set: portals can be saved and used. */
    ready: vaultReady(),
    /** The CRM helper's extension IDs, so the page can find it. */
    helperIds: env.PORTAL_HELPER_IDS,
  };
}

/** The people the Head or the department's HOD can put on a portal's list: its active office staff. */
export async function listPeople(departmentCode: string, user: UserWithDepartments) {
  const department = await prisma.department.findFirst({ where: { code: departmentCode, isActive: true } });
  if (!department) throw badRequest(`Unknown department: ${departmentCode}`);
  if (!canManagePortal(user, department.code)) throw forbidden("Only the Head and the department's HOD choose who may use its portals.");
  const people = await prisma.user.findMany({
    where: { isActive: true, type: "OFFICE", departments: { some: { departmentId: department.id } } },
    select: { id: true, name: true, departments: { where: { departmentId: department.id }, select: { role: true } } },
    orderBy: { name: "asc" },
  });
  return { people: people.map((p) => ({ id: p.id, name: p.name, role: p.departments[0]?.role ?? "STAFF" })) };
}

/** A portal's list holds only the department's active office staff. */
async function peopleOf(departmentId: number, userIds: string[]) {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return unique;
  const found = await prisma.user.count({
    where: { id: { in: unique }, isActive: true, type: "OFFICE", departments: { some: { departmentId } } },
  });
  if (found !== unique.length) throw fieldError("userIds", "Pick people who work in this department.");
  return unique;
}

/** The Head or the department's HOD adds a portal with its ID and password. */
export async function createPortalLogin(input: CreatePortalLoginInput, actor: Actor) {
  const department = await prisma.department.findFirst({ where: { code: input.departmentCode, isActive: true } });
  if (!department) throw badRequest(`Unknown department: ${input.departmentCode}`);
  if (!canManagePortal(actor.user, department.code)) throw forbidden("Only the Head and the department's HOD add its portals.");
  if (!vaultReady()) throw notSetUp();
  const userIds = await peopleOf(department.id, input.userIds);

  const id = randomUUID();
  const secret = seal({ loginId: input.loginId, password: input.password }, id);
  await prisma
    .$transaction(async (tx) => {
      await tx.portalLogin.create({
        data: {
          id,
          departmentId: department.id,
          name: input.name,
          loginUrl: input.loginUrl,
          idLabel: input.idLabel,
          secret,
          passwordChangedAt: new Date(),
          createdById: actor.user.id,
        },
      });
      if (userIds.length > 0) await tx.portalLoginUser.createMany({ data: userIds.map((userId) => ({ portalLoginId: id, userId })) });
      const after = portalLoginSnapshot({ departmentId: department.id, name: input.name, loginUrl: input.loginUrl, idLabel: input.idLabel, status: "ACTIVE", userIds });
      await audit({ actorId: actor.user.id, action: "portalLogin.create", entityType: "PortalLogin", entityId: id, after, ip: actor.ip }, tx);
    })
    .catch(rethrowUnique(`There's already a portal called "${input.name}" in ${department.name}.`));
  return toPortalLoginDto(await loadOr404(id), actor.user);
}

/**
 * The Head or the department's HOD changes a portal, from the version they opened (updatedAt). The ID and the password
 * change only when sent. Nothing changed: nothing written.
 */
export async function updatePortalLogin(id: string, input: UpdatePortalLoginInput, actor: Actor) {
  const before = await loadOr404(id);
  if (before.status === "REMOVED") throw badRequest("This portal was removed.");
  if (!canManagePortal(actor.user, before.department.code)) throw forbidden("Only the Head and the department's HOD change its portals.");
  assertFresh(before.updatedAt, input.updatedAt, "portal");

  const beforeUserIds = before.users.map((u) => u.user.id);
  const userIds = input.userIds === undefined ? beforeUserIds : await peopleOf(before.departmentId, input.userIds);
  const fields = { name: input.name ?? before.name, loginUrl: input.loginUrl ?? before.loginUrl, idLabel: input.idLabel ?? before.idLabel };
  const oldSnapshot = portalLoginSnapshot({ ...before, userIds: beforeUserIds });
  const newSnapshot = portalLoginSnapshot({ ...before, ...fields, userIds });
  const idChanged = input.loginId !== undefined;
  const passwordChanged = input.password !== undefined;
  const listChanged = JSON.stringify(oldSnapshot.userIds) !== JSON.stringify(newSnapshot.userIds);
  if (!idChanged && !passwordChanged && JSON.stringify(oldSnapshot) === JSON.stringify(newSnapshot)) {
    return toPortalLoginDto(before, actor.user);
  }

  let secret: Uint8Array<ArrayBuffer> | undefined;
  if (idChanged || passwordChanged) {
    if (!vaultReady()) throw notSetUp();
    // Typing both needs nothing old: that's how an HOD replaces a login that can't be read.
    const kept = idChanged && passwordChanged ? undefined : openPortalSecret(before);
    secret = seal({ loginId: input.loginId ?? kept!.loginId, password: input.password ?? kept!.password }, id);
  }
  const now = new Date();
  await prisma
    .$transaction(async (tx) => {
      // The updatedAt condition makes a save that raced past assertFresh fail instead of overwriting. The row is always
      // written, so a change to the list alone moves updatedAt too.
      const { count } = await tx.portalLogin.updateMany({
        where: { id, status: "ACTIVE", updatedAt: before.updatedAt },
        data: { ...fields, ...(secret ? { secret } : {}), ...(passwordChanged ? { passwordChangedAt: now } : {}), updatedAt: now },
      });
      if (count === 0) throw staleError("portal");
      if (listChanged) {
        await tx.portalLoginUser.deleteMany({ where: { portalLoginId: id } });
        if (userIds.length > 0) await tx.portalLoginUser.createMany({ data: userIds.map((userId) => ({ portalLoginId: id, userId })) });
      }
      const after = { ...newSnapshot, ...(idChanged ? { idChanged: true } : {}), ...(passwordChanged ? { passwordChanged: true } : {}) };
      await audit({ actorId: actor.user.id, action: "portalLogin.update", entityType: "PortalLogin", entityId: id, before: oldSnapshot, after, ip: actor.ip }, tx);
    })
    .catch(rethrowUnique(`There's already a portal called "${fields.name}" in ${before.department.name}.`));
  return toPortalLoginDto(await loadOr404(id), actor.user);
}

/**
 * Off the list: its ID and password are wiped, the row is kept for the record, and the visas whose cases opened it stop
 * naming it (component 3). Removing a removed portal changes nothing.
 */
export async function removePortalLogin(id: string, actor: Actor) {
  const before = await loadOr404(id);
  if (!canManagePortal(actor.user, before.department.code)) throw forbidden("Only the Head and the department's HOD remove its portals.");
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.portalLogin.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "REMOVED", secret: null } });
    if (count === 0) return;
    await audit(
      { actorId: actor.user.id, action: "portalLogin.remove", entityType: "PortalLogin", entityId: id, before: { status: "ACTIVE" }, after: { status: "REMOVED" }, ip: actor.ip },
      tx,
    );
    const visas = await tx.visaOffering.findMany({ where: { portalLoginId: id }, select: { id: true } });
    if (visas.length === 0) return;
    await tx.visaOffering.updateMany({ where: { portalLoginId: id }, data: { portalLoginId: null } });
    await auditMany(
      visas.map((v) => ({
        actorId: actor.user.id,
        action: "visaOffering.update",
        entityType: "VisaOffering",
        entityId: String(v.id),
        before: { portalLoginId: id },
        after: { portalLoginId: null },
        ip: actor.ip,
      })),
      tx,
    );
  });
  return toPortalLoginDto(await loadOr404(id), actor.user);
}
