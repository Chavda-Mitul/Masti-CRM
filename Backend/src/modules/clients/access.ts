import type { Prisma } from "../../../generated/prisma/client";
import { prisma } from "../../config/prisma";
import { forbidden } from "../../lib/httpError";
import { can, canEditAnyDepartment, isHodOfAny } from "../auth/permissions";
import { viewableDepartments } from "../enquiries/enquiries.service";
import { visibleEnquiryWhere } from "../enquiries/visibility";
import type { UserWithDepartments } from "../users/user";

// Who may do what with clients (docs/decisions/0004-client-master.md, amendments 2 and 4).
// Clients are shared by every department, so there is no single department to check:
// - the Clients tab (the directory, search, adding a client there): the Head and Accounts list every client; an HOD
//   lists the clients of the departments they head, and the clients nobody has a case for yet
// - one client: what their Clients tab lists, or a client of a case they can see (visibility.ts), so staff never
//   browse every client but still see everything about their own enquiry
// - changing: also EDIT in at least one department (the route chain refuses field staff)
// - accounting code, billing cycle, payment habit: Accounts EDIT (or the Head)
// The New enquiry lookup by mobile stays open to office staff: it is how intake finds the client.

/** Sees every client: the Head, or Accounts (they bill every client). */
const seesEveryClient = (user: UserWithDepartments) => can(user, "ACCOUNTS", "VIEW");

/** May open the Clients tab: the Head, Accounts, or an HOD (who lists their departments' clients, clientsTabWhere). */
export function canBrowseClients(user: UserWithDepartments): boolean {
  return isHodOfAny(user) || seesEveryClient(user);
}

export function assertCanBrowseClients(user: UserWithDepartments) {
  if (!canBrowseClients(user)) throw forbidden("The client list is for HODs and Accounts. Open a client from your case.");
}

/**
 * The clients this user's Clients tab lists (0004 amendment 4, 21 Oct 2026): every client for the Head and Accounts;
 * for an HOD, the clients with a case in a department they head, or with no case yet (nobody's). A Holidays HOD doesn't
 * see a family that only has visa cases.
 */
export function clientsTabWhere(user: UserWithDepartments): Prisma.ClientWhereInput {
  if (seesEveryClient(user)) return {};
  const headed = user.departments.filter((d) => d.role === "HOD" && d.department.isActive).map((d) => d.departmentId);
  return { OR: [{ enquiries: { some: { departmentId: { in: headed } } } }, { enquiries: { none: {} } }] };
}

/**
 * May this user open this client? A client their Clients tab lists, or a client of a case they can see (finished cases
 * too). Others get 403 whether or not the client exists, so ids reveal nothing.
 */
export async function assertCanSeeClient(user: UserWithDepartments, clientId: string) {
  if (seesEveryClient(user)) return;
  if (isHodOfAny(user) && (await prisma.client.count({ where: { AND: [{ id: clientId }, clientsTabWhere(user)] } })) > 0) return;
  const departments = await viewableDepartments(user);
  const theirs = await prisma.enquiry.findFirst({ where: { AND: [{ clientId }, visibleEnquiryWhere(user, departments)] }, select: { id: true } });
  if (!theirs) throw forbidden("This client isn't on any of your cases. Ask your HOD.");
}

export function canEditClients(user: UserWithDepartments): boolean {
  return canEditAnyDepartment(user);
}

export function assertCanEditClients(user: UserWithDepartments) {
  if (!canEditClients(user)) throw forbidden("You can view clients but not change them. Ask your HOD for edit access.");
}

export const ACCOUNTS_FIELDS = ["accountingCode", "billingCycleId", "paymentHabitId"] as const;

/** `changed` lists the Accounts fields this request actually changes. */
export function assertCanChangeAccountsFields(user: UserWithDepartments, changed: readonly string[]) {
  if (changed.length > 0 && !can(user, "ACCOUNTS", "EDIT")) {
    throw forbidden("Only Accounts can set the accounting code, billing cycle or payment habit.");
  }
}
