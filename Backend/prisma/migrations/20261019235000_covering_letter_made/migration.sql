-- "Make the letter" on a visa case (docs/decisions/0019-covering-letters.md Decision 10): the covering-letter wording
-- used, who made it and when, and what it was filled in with, so a reprint after File preparation is the same letter.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- AlterTable
ALTER TABLE "VisaCase" ADD COLUMN     "coveringLetterFill" JSONB,
ADD COLUMN     "coveringLetterMadeAt" TIMESTAMPTZ(3),
ADD COLUMN     "coveringLetterMadeById" TEXT,
ADD COLUMN     "coveringLetterVersionId" INTEGER;

-- CreateIndex
CREATE INDEX "VisaCase_coveringLetterVersionId_idx" ON "VisaCase"("coveringLetterVersionId");

-- AddForeignKey
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_coveringLetterVersionId_fkey" FOREIGN KEY ("coveringLetterVersionId") REFERENCES "CoveringLetterVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_coveringLetterMadeById_fkey" FOREIGN KEY ("coveringLetterMadeById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (Prisma can't express these). prisma migrate diff will propose dropping the index; it stays.

-- A made letter has all four: the wording, who, when and what it was filled in with; a case without one has none.
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_covering_letter_together" CHECK (
  ("coveringLetterVersionId" IS NULL) = ("coveringLetterMadeAt" IS NULL)
  AND ("coveringLetterVersionId" IS NULL) = ("coveringLetterMadeById" IS NULL)
  AND ("coveringLetterVersionId" IS NULL) = ("coveringLetterFill" IS NULL)
);
