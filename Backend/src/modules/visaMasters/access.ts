import { forbidden } from "../../lib/httpError";
import { isHodOf, isHodOfAny } from "../auth/permissions";
import type { UserWithDepartments } from "../users/user";

// Who may change the system masters (docs/decisions/0005-system-masters.md §8). "Only Vimal and HODs" ⚠️.
// - countries, visa types, offerings, documents, checklists: the Head or the Visa HOD
// - embassies (holiday targets, used by every department): the Head or any HOD

export function assertCanEditVisaMasters(user: UserWithDepartments) {
  if (!isHodOf(user, "VISA")) throw forbidden("Only the Head or the Visa HOD can change visa masters.");
}

export function assertCanEditEmbassies(user: UserWithDepartments) {
  if (!isHodOfAny(user)) throw forbidden("Only the Head or an HOD can change embassies.");
}
