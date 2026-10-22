import type { DepartmentStage, VisaCase } from "../../../generated/prisma/client";
import type { VisaOutcome } from "../../../generated/prisma/enums";
import { evisaDone } from "../enquiries/visibility";
import { heldShort } from "./shortfall";

// What a visa case's next step is, in the lists. Usually the step's own label (DepartmentStage.nextStepLabel), but at
// Steps 4 to 7 it depends on the case, as the case page's header button does (CaseHeader.tsx):
// - Step 4: an e-visa is submitted online; a paper file is added to a docket, then the docket is dispatched (0008
//   Decisions 2, 9 and 11). Fixed 21 Oct 2026: every Step 4 case said "Dispatch the docket".
// - Step 5: the vendor confirms they got the file, then gives its file number, then the decision is awaited (0011
//   Decisions 2–4). Fixed 21 Oct 2026: every Step 5 case said "Record the decision".
// - Steps 6–7: the passports' way back (docs/decisions/0013-visa-passport-back.md Decisions 3–5), and a short return,
//   held until the rest come in or the shortfall is cleared (Decision 5, amended).
// - An e-visa at Decision: its PDFs go to the client, then the passports we hold go back; with everyone refused,
//   there's nothing to send (docs/decisions/0025-evisa-after-decision.md, parts 3–5).

type CaseState = Pick<
  VisaCase,
  | "docketId"
  | "vendorReceivedAt"
  | "submittedAt"
  | "submittedOnlineAt"
  | "evisaSentAt"
  | "passportsInTransitAt"
  | "passportsReceivedAt"
  | "shortfallClearedAt"
  | "bookletsCurrent"
  | "bookletsOld"
  | "bookletsBackCurrent"
  | "bookletsBackOld"
> & { travellers: { outcome: VisaOutcome | null }[]; offering: { vendorNeeded: boolean } };

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
  // An e-visa's passports never left the office: it's sent (unless everyone was refused), then any we hold go back
  // (0025, parts 3–5).
  if (stage.code === "DECISION" && visa.submittedOnlineAt) return evisaDone(visa) ? "Hand back the passports" : "Send the e-visa";
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
