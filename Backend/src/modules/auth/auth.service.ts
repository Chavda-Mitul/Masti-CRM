import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { badRequest, forbidden, HttpError } from "../../lib/httpError";
import { toUserDto, withDepartments, type UserWithDepartments } from "../users/user";
import type { ChangePasswordInput, LoginInput } from "./auth.schemas";
import { parseIdentifier } from "./identifier";
import { officeNetworkAllows } from "./officeNetwork";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "./password";
import { createSession, findSession, revokeSession, revokeUserSessions, type ClientInfo } from "./session";

const LOGIN_FAILED = "Wrong mobile number/email or password.";

/** Checks the credentials and opens a session. The caller sets the cookie from `token` and `expiresAt`. */
export async function login(input: LoginInput, client: ClientInfo) {
  const identifier = parseIdentifier(input.identifier);

  const user = identifier
    ? await prisma.user.findUnique({
        where: identifier.kind === "email" ? { email: identifier.email } : { mobile: identifier.mobile },
        include: withDepartments,
      })
    : null;

  // Always run a password check so response time doesn't reveal whether the account exists.
  const passwordOk = user ? await verifyPassword(user.passwordHash, input.password) : await verifyAgainstDummy(input.password);

  if (!user || !passwordOk || !user.isActive) {
    await audit({
      action: "auth.login.failed",
      entityType: "User",
      entityId: user?.id ?? null,
      after: {
        identifier: input.identifier.slice(0, 100),
        reason: !user ? "unknown_user" : !passwordOk ? "wrong_password" : "inactive_user",
      },
      ip: client.ip,
    });
    throw new HttpError(401, LOGIN_FAILED);
  }

  if (!(await officeNetworkAllows(user, client.ip ?? undefined))) {
    await audit({
      actorId: user.id,
      action: "auth.login.blocked_network",
      entityType: "User",
      entityId: user.id,
      ip: client.ip,
    });
    throw forbidden("The CRM can only be used from the office network.");
  }

  return prisma.$transaction(async (tx) => {
    const { token, session } = await createSession(user.id, client, tx);
    const updated = await tx.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
      include: withDepartments,
    });
    await audit({ actorId: user.id, action: "auth.login.success", entityType: "User", entityId: user.id, ip: client.ip }, tx);
    return { user: toUserDto(updated), token, expiresAt: session.expiresAt };
  });
}

/** Ends the session for this cookie token, if it is still valid. */
export async function logout(token: string, ip: string | null) {
  const session = await findSession(token);
  if (!session) return;
  await revokeSession(session.id);
  await audit({ actorId: session.userId, action: "auth.logout", entityType: "User", entityId: session.userId, ip });
}

/**
 * Changes the user's own password and signs out every other device (keeps `currentSessionId`).
 *
 * The forced change after a temporary-password login doesn't ask for the temporary password again:
 * the user typed it to open this session, and findSession ends such sessions after a few minutes.
 * Every other change needs the current password.
 */
export async function changePassword(
  user: UserWithDepartments,
  currentSessionId: string | undefined,
  input: ChangePasswordInput,
  ip: string | null,
) {
  if (!user.mustChangePassword) {
    if (!input.currentPassword) throw badRequest("Enter your current password.");
    if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
      throw badRequest("Your current password is not correct.");
    }
  }
  // A forced change may send no current password, so compare the new one with the stored hash.
  const sameAsCurrent = user.mustChangePassword
    ? await verifyPassword(user.passwordHash, input.newPassword)
    : input.newPassword === input.currentPassword;
  if (sameAsCurrent) {
    throw badRequest("Choose a new password that is different from the current one.");
  }

  // Hash before opening the transaction: argon2 is deliberately slow.
  const passwordHash = await hashPassword(input.newPassword);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false },
      include: withDepartments,
    });
    await revokeUserSessions(user.id, currentSessionId, tx);
    await audit({ actorId: user.id, action: "auth.password.change", entityType: "User", entityId: user.id, ip }, tx);
    return toUserDto(updated);
  });
}
