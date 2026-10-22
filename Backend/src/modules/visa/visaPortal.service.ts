import { env } from "../../config/env";
import { prisma } from "../../config/prisma";
import { badRequest, conflict, forbidden } from "../../lib/httpError";
import { canUsePortalOnCase, isPasswordLocked, portalLoginInclude } from "../portalLogins/portalLogin";
import { issueTicket } from "../portalLogins/portalHelper.service";
import type { Actor } from "../users/user";
import { findVisibleCase } from "./caseLock";

// "Log in for me" on the visa case (docs/decisions/0024-portal-logins.md, component 3): the portal its visa names
// (France · Tourist → France visa portal), from step 3 until the case closes. Besides the portal's list, the HOD and the
// Head, whoever the case is assigned to may press it. The press is kept with the case, for "Who used what".

const NO_PORTAL = "No portal saved for this visa. Ask your HOD to add it.";

/**
 * The portal a case's visa opens, as the case page needs it: who may use it is worked out there with the same rule as
 * here (canUsePortalOnCase), so the page gets the list's people; locked while its password change is overdue (component
 * 2). Null when none is saved or it's no longer in use.
 */
export async function casePortal(portalLoginId: string | null) {
  if (!portalLoginId) return null;
  const portal = await prisma.portalLogin.findUnique({ where: { id: portalLoginId }, include: portalLoginInclude });
  if (!portal || portal.status !== "ACTIVE" || !portal.department.isActive) return null;
  return {
    id: portal.id,
    name: portal.name,
    userIds: portal.users.map((u) => u.user.id),
    locked: isPasswordLocked(portal),
    helperIds: env.PORTAL_HELPER_IDS,
  };
}

/** A press on the case: the one-time ticket the page hands to the CRM helper. The ID and password never come here. */
export async function openCasePortal(caseNo: string, actor: Actor) {
  const { id } = await findVisibleCase(caseNo, actor.user);
  const enquiry = await prisma.enquiry.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      caseNo: true,
      status: true,
      ownerId: true,
      department: { select: { code: true } },
      visa: { select: { maturedAt: true, offering: { select: { portalLoginId: true } } } },
    },
  });
  if (enquiry.status === "POSTPONED") throw conflict("This case is postponed. Resume it first.");
  if (enquiry.status !== "OPEN") throw conflict("This case is closed.");
  if (!enquiry.visa?.maturedAt) throw conflict("Log in for me comes at step 3, once all the documents are in.");

  const portalLoginId = enquiry.visa.offering.portalLoginId;
  const portal = portalLoginId ? await prisma.portalLogin.findUnique({ where: { id: portalLoginId }, include: portalLoginInclude }) : null;
  if (!portal || portal.status !== "ACTIVE" || !portal.department.isActive) throw badRequest(NO_PORTAL);
  if (!canUsePortalOnCase(actor.user, portal, enquiry)) {
    throw forbidden("Only the person on this case, the HOD and the people on the portal's list can use it.");
  }
  return issueTicket(portal, actor, { id: enquiry.id, caseNo: enquiry.caseNo });
}
