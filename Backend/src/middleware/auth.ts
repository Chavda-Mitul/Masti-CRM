import type { Request, RequestHandler } from "express";
import type { Access, UserType } from "../../generated/prisma/client";
import { officeNetworkAllows } from "../auth/officeNetwork";
import { can } from "../auth/permissions";
import { clearSessionCookie, findSession, SESSION_COOKIE, setSessionCookie, touchSession } from "../auth/session";
import { forbidden, unauthorized } from "../lib/httpError";

/** Requires a valid session for an active user. Sets req.auth. */
export const requireAuth: RequestHandler = async (req, res, next) => {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== "string" || !token) throw unauthorized();

  const session = await findSession(token);
  if (!session || !session.user.isActive) {
    clearSessionCookie(res);
    throw unauthorized("Your session has ended. Please log in again.");
  }

  if (!(await officeNetworkAllows(session.user, req.ip))) {
    throw forbidden("The CRM can only be used from the office network.");
  }

  const expiresAt = await touchSession(session);
  if (expiresAt.getTime() !== session.expiresAt.getTime()) setSessionCookie(res, token, expiresAt);

  req.auth = { user: session.user, sessionId: session.id };
  next();
};

/** Use after requireAuth. */
export function currentUser(req: Request) {
  if (!req.auth) throw unauthorized();
  return req.auth.user;
}

/** Head (owner) only. Use after requireAuth. */
export const requireHead: RequestHandler = (req, _res, next) => {
  if (currentUser(req).type !== "HEAD") throw forbidden();
  next();
};

/**
 * Only these kinds of account. Use after requireAuth.
 * Department routes don't need it (requireDepartment already refuses field staff);
 * use it on routes with no department check, e.g. requireUserType("HEAD", "OFFICE") for desktop-only data.
 */
export function requireUserType(...types: UserType[]): RequestHandler {
  return (req, _res, next) => {
    if (!types.includes(currentUser(req).type)) throw forbidden();
    next();
  };
}

/** VIEW or EDIT access to a department (Head always passes). Use after requireAuth. */
export function requireDepartment(departmentCode: string, access: Access): RequestHandler {
  return (req, _res, next) => {
    if (!can(currentUser(req), departmentCode, access)) throw forbidden();
    next();
  };
}

/** Blocks everything except changing the password while a temporary password is in use. */
export const requirePasswordChanged: RequestHandler = (req, _res, next) => {
  if (currentUser(req).mustChangePassword) throw forbidden("Please change your temporary password first.");
  next();
};
