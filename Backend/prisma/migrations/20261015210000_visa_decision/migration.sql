-- Visa Step 6, the decision (docs/decisions/0012-visa-decision.md): each traveller's outcome, an approved one's sticker
-- (or e-visa) number and dates, and who recorded the decision and when.

-- CreateEnum
CREATE TYPE "VisaOutcome" AS ENUM ('APPROVED', 'REFUSED');

-- AlterTable
ALTER TABLE "VisaCase" ADD COLUMN     "decidedAt" TIMESTAMPTZ(3),
ADD COLUMN     "decidedById" TEXT;

-- AlterTable
ALTER TABLE "VisaCaseTraveller" ADD COLUMN     "outcome" "VisaOutcome",
ADD COLUMN     "validFrom" DATE,
ADD COLUMN     "validTo" DATE,
ADD COLUMN     "visaNo" TEXT;

-- AddForeignKey
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (Prisma can't express these).

-- An approved traveller has the number and both dates, valid-to on or after valid-from; a refused or undecided one has
-- none (Decision 3). The number is capitals, digits, single spaces, "-" and "/", 3–40, starting and ending with a
-- letter or digit.
ALTER TABLE "VisaCaseTraveller" ADD CONSTRAINT "VisaCaseTraveller_outcome_details" CHECK (
  ("outcome" = 'APPROVED' AND "visaNo" IS NOT NULL AND "validFrom" IS NOT NULL AND "validTo" IS NOT NULL AND "validTo" >= "validFrom")
  OR ("outcome" IS DISTINCT FROM 'APPROVED' AND "visaNo" IS NULL AND "validFrom" IS NULL AND "validTo" IS NULL)
);
ALTER TABLE "VisaCaseTraveller" ADD CONSTRAINT "VisaCaseTraveller_visa_no_format" CHECK (
  "visaNo" IS NULL OR ("visaNo" ~ '^[A-Z0-9][A-Z0-9 /-]{1,38}[A-Z0-9]$' AND position('  ' in "visaNo") = 0)
);

-- Who and when go together; a file is decided only once it was submitted (at the embassy or online), and a recalled
-- file never is (Decision 6).
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_decision_together" CHECK (("decidedAt" IS NULL) = ("decidedById" IS NULL));
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_decided_after_submission" CHECK (
  "decidedAt" IS NULL OR "submittedAt" IS NOT NULL OR "submittedOnlineAt" IS NOT NULL
);
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_decided_not_recalled" CHECK ("decidedAt" IS NULL OR "recalledAt" IS NULL);
