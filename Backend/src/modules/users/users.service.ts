import type { UserType } from "../../../generated/prisma/client";
import { prisma, type Db } from "../../config/prisma";
import { audit, auditMany } from "../../lib/audit";
import { cleanEmail, cleanMobile } from "../../lib/contact";
import { fromDbDate } from "../../lib/dates";
import { badRequest, conflict, HttpError, notFound } from "../../lib/httpError";
import { rethrowUnique } from "../../lib/prismaErrors";
import { generateTempPassword, hashPassword } from "../auth/password";
import { canOwnCases, type DepartmentCode } from "../auth/permissions";
import { UNFINISHED } from "../enquiries/visibility";
import { cancelBookedFieldJobs } from "../fieldJobs/fieldJobs.service";
import { toUserDto, withDepartments, type Actor, type UserWithDepartments } from "./user";
import type { CreateUserInput, Membership, UpdateUserInput } from "./users.schemas";

/** Department codes → rows to insert. HODs always get EDIT. */
async function resolveMemberships(memberships: Membership[]) {
  const codes = memberships.map((m) => m.departmentCode.toUpperCase());
  if (new Set(codes).size !== codes.length) throw badRequest("Each department can only be added once.");
  const departments = await prisma.department.findMany({ where: { code: { in: codes }, isActive: true } });
  return memberships.map((m) => {
    const department = departments.find((d) => d.code === m.departmentCode.toUpperCase());
    if (!department) throw badRequest(`Unknown department: ${m.departmentCode}`);
    return { departmentId: department.id, role: m.role, access: m.role === "HOD" ? ("EDIT" as const) : m.access };
  });
}

/** Rules that depend on the kind of account. The database enforces the same ones (docs/decisions/0002-user-types.md). */
function assertFitsType(type: UserType, mobile: string | null, departmentCount: number) {
  if (type === "OFFICE" && departmentCount === 0) throw badRequest("Give office staff at least one department.");
  if (type !== "OFFICE" && departmentCount > 0) {
    throw badRequest("Only office staff have department access. The Head sees every department; field staff see only their jobs.");
  }
  if (type === "FIELD" && !mobile) throw badRequest("Field staff need a mobile number: their jobs and handover codes come on WhatsApp.");
}

/** A clear 409 instead of a database error when a mobile/email belongs to someone else. */
async function assertUnique(mobile: string | null | undefined, email: string | null | undefined, exceptUserId?: string) {
  const notSelf = exceptUserId ? { id: { not: exceptUserId } } : {};
  if (mobile && (await prisma.user.findFirst({ where: { mobile, ...notSelf } }))) {
    throw conflict("This mobile number is already used by another user.");
  }
  if (email && (await prisma.user.findFirst({ where: { email, ...notSelf } }))) {
    throw conflict("This email is already used by another user.");
  }
}

/** Fallback if two requests race past assertUnique. */
const rethrowUniqueUser = rethrowUnique("This mobile number or email is already used by another user.");

async function getUserOr404(id: string) {
  const user = await prisma.user.findUnique({ where: { id }, include: withDepartments });
  if (!user) throw notFound("User not found.");
  return user;
}

/** True if someone other than this user is an active Head. */
async function anotherActiveHeadExists(userId: string, db: Db = prisma) {
  return (await db.user.count({ where: { type: "HEAD", isActive: true, id: { not: userId } } })) > 0;
}

const LAST_HEAD = "There must always be at least one active Head.";

/**
 * Inside the transaction that deactivates or demotes a Head: locks the active Head rows, then checks another one is left.
 * Without the lock, two Heads deactivating each other at the same moment could both pass the check and leave none.
 * A second request waits for the first to commit, and then no longer sees the first Head as active.
 */
async function lockAndAssertAnotherActiveHead(tx: Db, userId: string) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "type" = 'HEAD' AND "isActive" ORDER BY "id" FOR UPDATE`;
  if (!(await anotherActiveHeadExists(userId, tx))) throw new HttpError(409, LAST_HEAD);
}

/**
 * Hands back what someone can no longer do, in the transaction that switches them off or changes their access
 * (docs/decisions/0002-user-types.md amendment 1): their unfinished cases in the departments they can no longer edit
 * lose their owner and wait in "To assign" for the HOD, and a boy who is switched off or no longer field staff has his
 * booked jobs called off, so each case books another boy. Each is audited. Returns what was handed back.
 */
async function releaseWork(tx: Db, user: UserWithDepartments, actor: Actor, why: string) {
  const owned = await tx.enquiry.findMany({
    where: { AND: [{ ownerId: user.id }, UNFINISHED] },
    select: { id: true, department: { select: { code: true } } },
  });
  const lost = owned.filter((e) => !canOwnCases(user, e.department.code as DepartmentCode)).map((e) => e.id);
  const doesJobs = user.isActive && user.type === "FIELD";
  const jobCases = doesJobs ? [] : await tx.fieldJob.findMany({ where: { assigneeId: user.id, status: "BOOKED" }, select: { enquiryId: true } });
  const ids = [...new Set([...lost, ...jobCases.map((j) => j.enquiryId)])].sort();
  if (ids.length === 0) return { cases: [], fieldJobs: [] };
  // The cases' locks in id order (as a docket's dispatch takes them), so a save on one, or the boy's own step, waits.
  await tx.$queryRaw`SELECT "id" FROM "Enquiry" WHERE "id" = ANY(${ids}) ORDER BY "id" FOR UPDATE`;

  // Read again under the locks: only what is still theirs and unfinished.
  const released = await tx.enquiry.findMany({
    where: { AND: [{ id: { in: lost }, ownerId: user.id }, UNFINISHED] },
    select: { id: true, caseNo: true, clientId: true },
    orderBy: { caseNo: "asc" },
  });
  await tx.enquiry.updateMany({ where: { id: { in: released.map((e) => e.id) } }, data: { ownerId: null } });
  await auditMany(
    released.map((e) => ({
      actorId: actor.user.id,
      action: "enquiry.unassign",
      entityType: "Enquiry",
      entityId: e.id,
      clientId: e.clientId,
      before: { ownerId: user.id },
      after: { ownerId: null, why },
      ip: actor.ip,
    })),
    tx,
  );
  const fieldJobs = doesJobs ? [] : await cancelBookedFieldJobs(tx, { assigneeId: user.id }, actor, why);
  return { cases: released.map((e) => e.caseNo), fieldJobs };
}

/** What releaseWork handed back, for the user change's audit: nothing when there was nothing. */
function handedBack(released: Awaited<ReturnType<typeof releaseWork>>) {
  return {
    ...(released.cases.length > 0 ? { casesToAssign: released.cases } : {}),
    ...(released.fieldJobs.length > 0 ? { fieldJobsCancelled: released.fieldJobs } : {}),
  };
}

/**
 * What the Deactivate and Edit dialogs warn about before saving: the person's unfinished cases (by department) and,
 * for a boy, his booked jobs. Saving hands back the ones they can no longer do (releaseWork).
 */
export async function openWork(id: string) {
  const user = await getUserOr404(id);
  const [cases, jobs] = await Promise.all([
    prisma.enquiry.findMany({
      where: { AND: [{ ownerId: user.id }, UNFINISHED] },
      select: { caseNo: true, status: true, department: { select: { code: true, name: true } }, client: { select: { name: true } } },
      orderBy: { caseNo: "asc" },
    }),
    prisma.fieldJob.findMany({
      where: { assigneeId: user.id, status: "BOOKED" },
      select: { id: true, kind: true, day: true, enquiry: { select: { caseNo: true, client: { select: { name: true } } } } },
      orderBy: [{ day: "asc" }, { id: "asc" }],
    }),
  ]);
  return {
    cases,
    fieldJobs: jobs.map((j) => ({ id: j.id, kind: j.kind, day: fromDbDate(j.day), caseNo: j.enquiry.caseNo, client: j.enquiry.client })),
  };
}

export async function listUsers() {
  const users = await prisma.user.findMany({ include: withDepartments, orderBy: { name: "asc" } });
  return users.map(toUserDto);
}

export async function getUser(id: string) {
  return toUserDto(await getUserOr404(id));
}

/** Creates a user. `tempPassword` is set (and must be shown once) when no password was given. */
export async function createUser(input: CreateUserInput, actor: Actor) {
  const mobile = cleanMobile(input.mobile) ?? null;
  const email = cleanEmail(input.email) ?? null;
  if (!mobile && !email) throw badRequest("Enter a mobile number or an email (or both).");
  assertFitsType(input.type, mobile, input.departments.length);
  await assertUnique(mobile, email);
  const memberships = await resolveMemberships(input.departments);

  const tempPassword = input.password ? undefined : generateTempPassword();
  const passwordHash = await hashPassword(input.password ?? (tempPassword as string));

  const user = await prisma
    .$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name: input.name,
          mobile,
          email,
          type: input.type,
          passwordHash,
          mustChangePassword: true,
          departments: { create: memberships },
        },
        include: withDepartments,
      });
      await audit(
        { actorId: actor.user.id, action: "user.create", entityType: "User", entityId: created.id, after: toUserDto(created), ip: actor.ip },
        tx,
      );
      return created;
    })
    .catch(rethrowUniqueUser);

  return { user: toUserDto(user), tempPassword };
}

export async function updateUser(id: string, input: UpdateUserInput, actor: Actor) {
  const before = await getUserOr404(id);

  const mobile = cleanMobile(input.mobile);
  const email = cleanEmail(input.email);
  const finalMobile = mobile === undefined ? before.mobile : mobile;
  const finalEmail = email === undefined ? before.email : email;
  if (!finalMobile && !finalEmail) throw badRequest("A user needs a mobile number or an email (or both).");

  const finalType = input.type ?? before.type;
  const leavesHead = before.type === "HEAD" && finalType !== "HEAD" && before.isActive;
  if (leavesHead && !(await anotherActiveHeadExists(before.id))) throw new HttpError(409, LAST_HEAD);
  const memberships = input.departments ? await resolveMemberships(input.departments) : undefined;
  // Becoming Head or field staff drops any department access the user had.
  const finalDepartmentCount = memberships ? memberships.length : finalType === "OFFICE" ? before.departments.length : 0;
  assertFitsType(finalType, finalMobile, finalDepartmentCount);
  await assertUnique(mobile, email, before.id);

  const updated = await prisma
    .$transaction(async (tx) => {
      if (leavesHead) await lockAndAssertAnotherActiveHead(tx, before.id);
      // Order matters to the database triggers: department rows go before the type leaves OFFICE,
      // and new ones are added after it becomes OFFICE.
      if (finalType !== "OFFICE") await tx.userDepartment.deleteMany({ where: { userId: before.id } });
      await tx.user.update({
        where: { id: before.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(mobile !== undefined ? { mobile } : {}),
          ...(email !== undefined ? { email } : {}),
          ...(input.type !== undefined ? { type: input.type } : {}),
        },
      });
      if (finalType === "OFFICE" && memberships) {
        // Only switched-on departments are replaced. Roles in switched-off ones grant nothing and the screens can't
        // show them, so they are kept for when the department is switched on again.
        await tx.userDepartment.deleteMany({ where: { userId: before.id, department: { isActive: true } } });
        await tx.userDepartment.createMany({ data: memberships.map((m) => ({ ...m, userId: before.id })) });
      }
      const user = await tx.user.findUniqueOrThrow({ where: { id: before.id }, include: withDepartments });
      const released = await releaseWork(tx, user, actor, "user's access changed");
      await audit(
        {
          actorId: actor.user.id,
          action: "user.update",
          entityType: "User",
          entityId: user.id,
          before: toUserDto(before),
          after: { ...toUserDto(user), ...handedBack(released) },
          ip: actor.ip,
        },
        tx,
      );
      return user;
    })
    .catch(rethrowUniqueUser);

  return toUserDto(updated);
}

export async function deactivateUser(id: string, actor: Actor) {
  const before = await getUserOr404(id);
  if (before.id === actor.user.id) throw badRequest("You can't deactivate yourself.");
  const leavesHead = before.type === "HEAD" && before.isActive;
  if (leavesHead && !(await anotherActiveHeadExists(before.id))) throw new HttpError(409, LAST_HEAD);

  const updated = await prisma.$transaction(async (tx) => {
    if (leavesHead) await lockAndAssertAnotherActiveHead(tx, before.id);
    const user = await tx.user.update({ where: { id: before.id }, data: { isActive: false }, include: withDepartments });
    // Ends access immediately: every open session for this user is deleted.
    await tx.session.deleteMany({ where: { userId: before.id } });
    const released = await releaseWork(tx, user, actor, "user deactivated");
    await audit(
      {
        actorId: actor.user.id,
        action: "user.deactivate",
        entityType: "User",
        entityId: user.id,
        before: toUserDto(before),
        after: { ...toUserDto(user), ...handedBack(released) },
        ip: actor.ip,
      },
      tx,
    );
    return user;
  });

  return toUserDto(updated);
}

export async function activateUser(id: string, actor: Actor) {
  const before = await getUserOr404(id);

  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id: before.id }, data: { isActive: true }, include: withDepartments });
    await audit(
      { actorId: actor.user.id, action: "user.activate", entityType: "User", entityId: user.id, before: toUserDto(before), after: toUserDto(user), ip: actor.ip },
      tx,
    );
    return user;
  });

  return toUserDto(updated);
}

/** Sets a new temporary password (returned once) and ends all of the user's sessions. */
export async function resetPassword(id: string, actor: Actor) {
  const before = await getUserOr404(id);
  if (before.id === actor.user.id) throw badRequest("Use 'Change password' to change your own password.");

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: before.id },
      data: { passwordHash, mustChangePassword: true },
      include: withDepartments,
    });
    await tx.session.deleteMany({ where: { userId: before.id } });
    await audit({ actorId: actor.user.id, action: "user.password.reset", entityType: "User", entityId: user.id, ip: actor.ip }, tx);
    return user;
  });

  return { user: toUserDto(updated), tempPassword };
}
