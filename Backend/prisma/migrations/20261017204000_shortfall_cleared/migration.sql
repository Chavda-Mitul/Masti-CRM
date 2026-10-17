-- A short return holds the handover (docs/decisions/0013-visa-passport-back.md Decision 5, amended 17 Oct 2026): when
-- fewer passports came back than went out and they won't come, whoever can act on the case clears the shortfall with a
-- reason from the missing-passport-reasons list. When, by whom and why are kept here; the booklets that come in late are
-- added to bookletsBackCurrent / bookletsBackOld ("Received the rest"), within their existing 0–50 checks.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- AlterTable
ALTER TABLE "VisaCase" ADD COLUMN     "shortfallClearedAt" TIMESTAMPTZ(3),
ADD COLUMN     "shortfallClearedById" TEXT,
ADD COLUMN     "shortfallReasonId" INTEGER;

-- AddForeignKey
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_shortfallClearedById_fkey" FOREIGN KEY ("shortfallClearedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_shortfallReasonId_fkey" FOREIGN KEY ("shortfallReasonId") REFERENCES "MissingPassportReason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- When, by whom and why: all three together, and only once the passports were received.
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_shortfall_cleared_together" CHECK (
  ("shortfallClearedAt" IS NULL) = ("shortfallClearedById" IS NULL)
  AND ("shortfallClearedAt" IS NULL) = ("shortfallReasonId" IS NULL)
);
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_shortfall_cleared_after_receipt" CHECK (
  "shortfallClearedAt" IS NULL OR "passportsReceivedAt" IS NOT NULL
);
