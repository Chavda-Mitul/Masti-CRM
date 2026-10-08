import { Router } from "express";
import { z } from "zod";
import { Prisma, UserType } from "../../generated/prisma/client";
import { prisma } from "../config/prisma";
import { normaliseEmail, normaliseMobile } from "../auth/identifier";
import { generateTempPassword, hashPassword, MIN_PASSWORD_LENGTH } from "../auth/password";
import { toUserDto, withDepartments } from "../auth/user";
import { audit } from "../lib/audit";
import { badRequest, conflict, HttpError, notFound } from "../lib/httpError";
import { currentUser, requireAuth, requireHead, requirePasswordChanged } from "../middleware/auth";

/**
 * User management. Head only for now.
 * (Whether HODs can manage their own department's users is an open question.)
 */
const router = Router();
router.use(requireAuth, requirePasswordChanged, requireHead);

const membershipSchema = z.object({
  departmentCode: z.string().trim().min(1),
  role: z.enum(["STAFF", "HOD"]),
  access: z.enum(["VIEW", "EDIT"]),
});

const createSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(100),
  mobile: z.string().trim().max(30).nullish(),
  email: z.string().trim().max(200).nullish(),
  type: z.enum(UserType).default("OFFICE"),
  departments: z.array(membershipSchema).default([]),
  /** Optional: if missing, a temporary password is generated and returned once. */
  password: z.string().min(MIN_PASSWORD_LENGTH).max(200).optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(100).optional(),
  mobile: z.string().trim().max(30).nullish(),
  email: z.string().trim().max(200).nullish(),
  type: z.enum(UserType).optional(),
  departments: z.array(membershipSchema).optional(),
});

type Membership = z.infer<typeof membershipSchema>;

/** "" and null clear the field; undefined means "not sent". */
function cleanMobile(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const mobile = normaliseMobile(value);
  if (!mobile) throw badRequest("Enter a valid 10-digit Indian mobile number.");
  return mobile;
}

function cleanEmail(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const email = normaliseEmail(value);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest("Enter a valid email address.");
  return email;
}

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
function rethrowUnique(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw conflict("This mobile number or email is already used by another user.");
  }
  throw err;
}

async function getUserOr404(id: string) {
  const user = await prisma.user.findUnique({ where: { id }, include: withDepartments });
  if (!user) throw notFound("User not found.");
  return user;
}

/** True if someone other than this user is an active Head. */
async function anotherActiveHeadExists(userId: string) {
  return (await prisma.user.count({ where: { type: "HEAD", isActive: true, id: { not: userId } } })) > 0;
}

router.get("/", async (_req, res) => {
  const users = await prisma.user.findMany({ include: withDepartments, orderBy: { name: "asc" } });
  res.json({ users: users.map(toUserDto) });
});

router.get("/:id", async (req, res) => {
  res.json({ user: toUserDto(await getUserOr404(req.params.id)) });
});

router.post("/", async (req, res) => {
  const body = createSchema.parse(req.body);
  const actor = currentUser(req);
  const mobile = cleanMobile(body.mobile) ?? null;
  const email = cleanEmail(body.email) ?? null;
  if (!mobile && !email) throw badRequest("Enter a mobile number or an email (or both).");
  assertFitsType(body.type, mobile, body.departments.length);
  await assertUnique(mobile, email);
  const memberships = await resolveMemberships(body.departments);

  const tempPassword = body.password ? undefined : generateTempPassword();
  const passwordHash = await hashPassword(body.password ?? (tempPassword as string));

  const user = await prisma
    .$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name: body.name,
          mobile,
          email,
          type: body.type,
          passwordHash,
          mustChangePassword: true,
          departments: { create: memberships },
        },
        include: withDepartments,
      });
      await audit(
        { actorId: actor.id, action: "user.create", entityType: "User", entityId: created.id, after: toUserDto(created), ip: req.ip ?? null },
        tx,
      );
      return created;
    })
    .catch(rethrowUnique);

  res.status(201).json({ user: toUserDto(user), ...(tempPassword ? { tempPassword } : {}) });
});

router.patch("/:id", async (req, res) => {
  const body = updateSchema.parse(req.body);
  const actor = currentUser(req);
  const before = await getUserOr404(req.params.id);

  const mobile = cleanMobile(body.mobile);
  const email = cleanEmail(body.email);
  const finalMobile = mobile === undefined ? before.mobile : mobile;
  const finalEmail = email === undefined ? before.email : email;
  if (!finalMobile && !finalEmail) throw badRequest("A user needs a mobile number or an email (or both).");

  const finalType = body.type ?? before.type;
  if (before.type === "HEAD" && finalType !== "HEAD" && before.isActive && !(await anotherActiveHeadExists(before.id))) {
    throw new HttpError(409, "There must always be at least one active Head.");
  }
  const memberships = body.departments ? await resolveMemberships(body.departments) : undefined;
  // Becoming Head or field staff drops any department access the user had.
  const finalDepartmentCount = memberships ? memberships.length : finalType === "OFFICE" ? before.departments.length : 0;
  assertFitsType(finalType, finalMobile, finalDepartmentCount);
  await assertUnique(mobile, email, before.id);

  const updated = await prisma
    .$transaction(async (tx) => {
      // Order matters to the database triggers: department rows go before the type leaves OFFICE,
      // and new ones are added after it becomes OFFICE.
      if (finalType !== "OFFICE") await tx.userDepartment.deleteMany({ where: { userId: before.id } });
      await tx.user.update({
        where: { id: before.id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(mobile !== undefined ? { mobile } : {}),
          ...(email !== undefined ? { email } : {}),
          ...(body.type !== undefined ? { type: body.type } : {}),
        },
      });
      if (finalType === "OFFICE" && memberships) {
        await tx.userDepartment.deleteMany({ where: { userId: before.id } });
        await tx.userDepartment.createMany({ data: memberships.map((m) => ({ ...m, userId: before.id })) });
      }
      const user = await tx.user.findUniqueOrThrow({ where: { id: before.id }, include: withDepartments });
      await audit(
        {
          actorId: actor.id,
          action: "user.update",
          entityType: "User",
          entityId: user.id,
          before: toUserDto(before),
          after: toUserDto(user),
          ip: req.ip ?? null,
        },
        tx,
      );
      return user;
    })
    .catch(rethrowUnique);

  res.json({ user: toUserDto(updated) });
});

router.post("/:id/deactivate", async (req, res) => {
  const actor = currentUser(req);
  const before = await getUserOr404(req.params.id);
  if (before.id === actor.id) throw badRequest("You can't deactivate yourself.");
  if (before.type === "HEAD" && before.isActive && !(await anotherActiveHeadExists(before.id))) {
    throw new HttpError(409, "There must always be at least one active Head.");
  }

  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id: before.id }, data: { isActive: false }, include: withDepartments });
    // Ends access immediately: every open session for this user is deleted.
    await tx.session.deleteMany({ where: { userId: before.id } });
    await audit(
      { actorId: actor.id, action: "user.deactivate", entityType: "User", entityId: user.id, before: toUserDto(before), after: toUserDto(user), ip: req.ip ?? null },
      tx,
    );
    return user;
  });

  res.json({ user: toUserDto(updated) });
});

router.post("/:id/activate", async (req, res) => {
  const actor = currentUser(req);
  const before = await getUserOr404(req.params.id);

  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id: before.id }, data: { isActive: true }, include: withDepartments });
    await audit(
      { actorId: actor.id, action: "user.activate", entityType: "User", entityId: user.id, before: toUserDto(before), after: toUserDto(user), ip: req.ip ?? null },
      tx,
    );
    return user;
  });

  res.json({ user: toUserDto(updated) });
});

router.post("/:id/reset-password", async (req, res) => {
  const actor = currentUser(req);
  const before = await getUserOr404(req.params.id);
  if (before.id === actor.id) throw badRequest("Use 'Change password' to change your own password.");

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id: before.id },
      data: { passwordHash, mustChangePassword: true },
      include: withDepartments,
    });
    await tx.session.deleteMany({ where: { userId: before.id } });
    await audit({ actorId: actor.id, action: "user.password.reset", entityType: "User", entityId: user.id, ip: req.ip ?? null }, tx);
    return user;
  });

  res.json({ user: toUserDto(updated), tempPassword });
});

export default router;
