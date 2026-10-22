import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { badRequest, conflict, forbidden, HttpError, notFound } from "../../lib/httpError";
import { vaultReady } from "../../lib/secretBox";
import { getOfficeNetworkSetting, ipAllowed, portalLoginNetwork, sameAddress } from "../auth/officeNetwork";
import { withDepartments, type Actor, type UserWithDepartments } from "../users/user";
import { canUsePortal, canUsePortalOnCase, isPasswordLocked, portalLoginInclude, type PasswordDates } from "./portalLogin";
import type { OutcomeInput } from "./portalLogins.schemas";
import { notSetUp, openPortalSecret } from "./portalLogins.service";

// "Log in for me" (docs/decisions/0024-portal-logins.md). A press makes a one-time ticket; the page hands it to the CRM
// helper (a Chrome extension), which collects the ID and password with it and types them into the portal. The ticket
// lives 30 seconds, works once, only for the helper, and only from the computer that pressed (or the office); collecting
// checks everything again. The secret goes only to the helper, never to a CRM page. The helper then tells the page what
// happened, and the page reports it here.

/** How long a ticket can be collected for: the helper does it within a second of the press. */
export const TICKET_SECONDS = 30;

const hashOf = (ticket: string) => createHash("sha256").update(ticket).digest("hex");

const runOut = () => new HttpError(410, "This login has run out. Press Log in for me again.");
const onlyInOffice = () => forbidden("Log in for me works only in the office.");
/** Its scheduled password change is overdue (component 2). */
const lockedPortal = () => new HttpError(409, "This portal is locked until the HOD changes its password.", { code: "LOCKED" });

/** A press on Settings → Portal logins: checks the person may use the portal, then makes the ticket. */
export async function openPortalLogin(id: string, actor: Actor) {
  const portal = await prisma.portalLogin.findUnique({ where: { id }, include: portalLoginInclude });
  if (!portal) throw notFound("Portal not found.");
  if (portal.status !== "ACTIVE" || !portal.department.isActive) throw badRequest("This portal was removed.");
  if (!canUsePortal(actor.user, portal)) throw forbidden("You aren't on this portal's list. Ask your HOD.");
  return issueTicket(portal, actor, null);
}

/**
 * The ticket for a press the caller has allowed (here, or on a visa case: visaPortal.service.ts): the portal mustn't be
 * locked, the server must be set up and the office rule met, then the press is kept, with its case when there is one.
 */
export async function issueTicket(portal: { id: string } & PasswordDates, actor: Actor, onCase: { id: string; caseNo: string } | null) {
  if (isPasswordLocked(portal)) throw lockedPortal();
  if (!vaultReady()) throw notSetUp();
  if (!(await portalLoginNetwork(actor.ip ?? undefined)).allowed) throw onlyInOffice();

  const ticket = randomBytes(32).toString("base64url");
  const use = await prisma.$transaction(async (tx) => {
    const use = await tx.portalLoginUse.create({
      data: {
        portalLoginId: portal.id,
        userId: actor.user.id,
        openedIp: actor.ip,
        ticketHash: hashOf(ticket),
        ticketExpiresAt: new Date(Date.now() + TICKET_SECONDS * 1000),
        enquiryId: onCase?.id ?? null,
      },
    });
    const after = { useId: use.id, ...(onCase ? { caseNo: onCase.caseNo } : {}) };
    await audit({ actorId: actor.user.id, action: "portalLogin.open", entityType: "PortalLogin", entityId: portal.id, after, ip: actor.ip }, tx);
    return use;
  });
  return { useId: use.id, ticket };
}

/** A press made on a case may still be collected only while the case could still make it (component 3). */
async function caseStillAllows(enquiryId: string, user: UserWithDepartments, portal: Parameters<typeof canUsePortalOnCase>[1] & { id: string }) {
  const enquiry = await prisma.enquiry.findUnique({
    where: { id: enquiryId },
    select: {
      status: true,
      ownerId: true,
      department: { select: { code: true } },
      visa: { select: { maturedAt: true, offering: { select: { portalLoginId: true } } } },
    },
  });
  return (
    !!enquiry &&
    enquiry.status === "OPEN" &&
    !!enquiry.visa?.maturedAt &&
    enquiry.visa.offering.portalLoginId === portal.id &&
    canUsePortalOnCase(user, portal, enquiry)
  );
}

/** The ticket is spent and the press marked REFUSED; then the reason goes back to the helper. */
async function refuse(use: { id: string; portalLoginId: string; userId: string }, ip: string | null, reason: string, error: HttpError): Promise<never> {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.portalLoginUse.updateMany({
      where: { id: use.id, redeemedAt: null, outcome: null },
      data: { ticketHash: null, outcome: "REFUSED", outcomeAt: new Date() },
    });
    if (count === 0) return;
    await audit(
      { actorId: use.userId, action: "portalLogin.refuse", entityType: "PortalLogin", entityId: use.portalLoginId, after: { useId: use.id, reason }, ip },
      tx,
    );
  });
  throw error;
}

/**
 * The helper collects the ID and password with a ticket (the route has already checked it's the helper asking). Unknown,
 * spent and expired tickets get the same answer. Everything is checked again: the person, the portal, the office rule,
 * and that this is the computer that pressed (or an office one).
 */
export async function redeemTicket(ticket: string, ip: string | undefined) {
  const now = new Date();
  const use = await prisma.portalLoginUse.findUnique({ where: { ticketHash: hashOf(ticket) } });
  if (!use || use.redeemedAt || use.outcome || use.ticketExpiresAt <= now) throw runOut();
  const from = ip ?? null;

  const portal = await prisma.portalLogin.findUniqueOrThrow({ where: { id: use.portalLoginId }, include: portalLoginInclude });
  if (portal.status !== "ACTIVE" || !portal.department.isActive) {
    return refuse(use, from, "removed", new HttpError(410, "This portal was removed. Ask your HOD."));
  }
  if (isPasswordLocked(portal, now)) return refuse(use, from, "locked", lockedPortal());
  const user = await prisma.user.findUniqueOrThrow({ where: { id: use.userId }, include: withDepartments });
  const allowed = use.enquiryId ? await caseStillAllows(use.enquiryId, user, portal) : canUsePortal(user, portal);
  if (!allowed) return refuse(use, from, "not allowed", forbidden("You can't use this portal any more. Ask your HOD."));

  const { allow } = await getOfficeNetworkSetting();
  if (!(await portalLoginNetwork(ip)).allowed) return refuse(use, from, "outside the office", onlyInOffice());
  if (!sameAddress(ip, use.openedIp) && !(allow.length > 0 && ipAllowed(ip, allow))) {
    return refuse(use, from, "another computer", forbidden("Log in for me has to finish on the computer where it was pressed."));
  }

  let secret;
  try {
    secret = openPortalSecret(portal);
  } catch (err) {
    if (err instanceof HttpError) return refuse(use, from, "unreadable", err);
    throw err;
  }

  await prisma.$transaction(async (tx) => {
    // Spent once: a second collection racing this one finds no ticket.
    const { count } = await tx.portalLoginUse.updateMany({
      where: { id: use.id, ticketHash: use.ticketHash, redeemedAt: null, outcome: null, ticketExpiresAt: { gt: now } },
      data: { redeemedAt: now, redeemedIp: from, ticketHash: null },
    });
    if (count !== 1) throw runOut();
    await audit({ actorId: use.userId, action: "portalLogin.use", entityType: "PortalLogin", entityId: portal.id, after: { useId: use.id }, ip: from }, tx);
  });
  return { loginUrl: portal.loginUrl, loginId: secret.loginId, password: secret.password };
}

/** What the helper said happened, reported by the page of the person who pressed. Once per press. */
export async function reportOutcome(useId: string, input: OutcomeInput, actor: Actor) {
  const use = await prisma.portalLoginUse.findUnique({ where: { id: useId } });
  if (!use || use.userId !== actor.user.id) throw notFound("Not found.");
  const done = await prisma.$transaction(async (tx) => {
    const { count } = await tx.portalLoginUse.updateMany({ where: { id: useId, outcome: null }, data: { outcome: input.outcome, outcomeAt: new Date() } });
    if (count === 0) return false;
    await audit(
      { actorId: actor.user.id, action: "portalLogin.outcome", entityType: "PortalLogin", entityId: use.portalLoginId, after: { useId, outcome: input.outcome }, ip: actor.ip },
      tx,
    );
    return true;
  });
  if (!done) throw conflict("This press already has its answer.");
  return { outcome: input.outcome };
}
