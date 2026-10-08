import { forbidden } from "../../lib/httpError";
import { can, canEditAnyDepartment } from "../auth/permissions";
import type { UserWithDepartments } from "../users/user";

// Who may do what with clients (docs/decisions/0004-client-master.md).
// Clients are shared by every department, so there is no single department to check:
// - viewing: the Head and every office user (the route chain refuses field staff)
// - changing: the Head, or an office user with EDIT in at least one department
// - accounting code, billing cycle, payment habit: Accounts EDIT (or the Head)

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
