import type { DepartmentStage, VisaCase } from "../../../generated/prisma/client";
import { heldShort } from "./shortfall";

// What a visa case's next step is, in the lists. Usually the step's own label (DepartmentStage.nextStepLabel), but at
// Steps 4 to 7 it depends on the case, as the case page's header button does (CaseHeader.tsx):
// - Step 4: an e-visa is submitted online; a paper file is added to a docket, then the docket is dispatched (0008
//   Decisions 2, 9 and 11). Fixed 21 Oct 2026: every Step 4 case said "Dispatch the docket".
// - Step 5: the vendor confirms they got the file, then gives its file number, then the decision is awaited (0011
//   Decisions 2–4). Fixed 21 Oct 2026: every Step 5 case said "Record the decision".
// - Steps 6–7: the passports' way back (docs/decisions/0013-visa-passport-back.md Decisions 3–5), an e-visa, whose
//   passports never left the office (Decision 4), and a short return, held until the rest come in or the shortfall is
//   cleared (Decision 5, amended).

type CaseState = Pick<
  VisaCase,
  | "docketId"
  | "vendorReceivedAt"
  | "submittedAt"
  | "submittedOnlineAt"
  | "passportsInTransitAt"
  | "passportsReceivedAt"
  | "shortfallClearedAt"
  | "bookletsCurrent"
  | "bookletsOld"
  | "bookletsBackCurrent"
  | "bookletsBackOld"
> & { travellers: unknown[]; offering: { vendorNeeded: boolean } };

export function visaNextStep(stage: Pick<DepartmentStage, "code" | "nextStepLabel">, visa: CaseState | null): string {
  if (!visa) return stage.nextStepLabel;
  if (stage.code === "DISPATCH") {
    if (!visa.offering.vendorNeeded) return "Submit it online";
    if (!visa.docketId) return "Add to docket";
  }
  if (stage.code === "AT_VENDOR" && !visa.submittedOnlineAt) {
    if (!visa.vendorReceivedAt) return "Confirm vendor got it";
    if (!visa.submittedAt) return "Get the file number";
  }
  // ⚠️ An e-visa waits at Decision until Masti says what follows it (M39).
  if (stage.code === "DECISION" && visa.submittedOnlineAt) return "No passports to bring back (e-visa)";
  if (stage.code === "PASSPORT_BACK") {
    // Only a recalled file reaches Passport back before its passports are on the way.
    if (!visa.passportsInTransitAt) return "Passports on the way back";
    if (!visa.passportsReceivedAt) return "Mark received";
    // A short return holds the handover: the same words as the Passports coming back card (PassportsBackCard.tsx).
    const missing = heldShort({ ...visa, travellerCount: visa.travellers.length });
    if (missing) return missing.current + missing.old === 1 ? "Find the missing passport" : "Find the missing passports";
  }
  return stage.nextStepLabel;
}
