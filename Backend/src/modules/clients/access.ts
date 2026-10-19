import { prisma } from "../../config/prisma";
import { forbidden } from "../../lib/httpError";
import { can, canEditAnyDepartment, isHodOfAny } from "../auth/permissions";
import { viewableDepartments } from "../enquiries/enquiries.service";
import { visibleEnquiryWhere } from "../enquiries/visibility";
import type { UserWithDepartments } from "../users/user";

// Who may do what with clients (docs/decisions/0004-client-master.md, amendment of 19 Oct 2026).
// Clients are shared by every department, so there is no single department to check:
// - the whole list (the directory, search, adding a client there): the Head, any HOD and Accounts
// - one client: those, or office staff who can see one of the client's cases (visibility.ts), so staff never browse
//   every client but still see everything about their own enquiry
// - changing: also EDIT in at least one department (the route chain refuses field staff)
// - accounting code, billing cycle, payment habit: Accounts EDIT (or the Head)
// The New enquiry lookup by mobile stays open to office staff: it is how intake finds the client.

/** May browse every client: the Head, the HOD of any department, or Accounts (they bill every client). */
export function canBrowseClients(user: UserWithDepartments): boolean {
  return isHodOfAny(user) || can(user, "ACCOUNTS", "VIEW");
}

export function assertCanBrowseClients(user: UserWithDepartments) {
  if (!canBrowseClients(user)) throw forbidden("The client list is for HODs and Accounts. Open a client from your case.");
}

/**
 * May this user open this client? Anyone who may browse, or office staff who can see at least one of the client's
 * cases (finished ones too). Others get 403 whether or not the client exists, so ids reveal nothing.
 */
export async function assertCanSeeClient(user: UserWithDepartments, clientId: string) {
  if (canBrowseClients(user)) return;
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
