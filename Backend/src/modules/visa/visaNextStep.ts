import type { DepartmentStage, VisaCase } from "../../../generated/prisma/client";

// What a visa case's next step is, in the lists. Usually the step's own label (DepartmentStage.nextStepLabel), but at
// Steps 6 and 7 it depends on the case, as the case page's header button does (CaseHeader.tsx): the passports' way back
// (docs/decisions/0013-visa-passport-back.md Decisions 3–5) and an e-visa, whose passports never left the office
// (Decision 4).

type CaseState = Pick<VisaCase, "submittedOnlineAt" | "passportsInTransitAt" | "passportsReceivedAt">;

export function visaNextStep(stage: Pick<DepartmentStage, "code" | "nextStepLabel">, visa: CaseState | null): string {
  if (!visa) return stage.nextStepLabel;
  // ⚠️ An e-visa waits at Decision until Masti says what follows it (M39).
  if (stage.code === "DECISION" && visa.submittedOnlineAt) return "No passports to bring back (e-visa)";
  if (stage.code === "PASSPORT_BACK") {
    // Only a recalled file reaches Passport back before its passports are on the way.
    if (!visa.passportsInTransitAt) return "Passports on the way back";
    if (!visa.passportsReceivedAt) return "Mark received";
  }
  return stage.nextStepLabel;
}
