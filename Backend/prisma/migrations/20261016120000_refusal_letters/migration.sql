-- Visa Step 6, the refusal letter (docs/decisions/0012-visa-decision.md Decision 4): a refused traveller's letter, scanned
-- as a PDF and kept with the case's files. A newer upload is the current one; older ones stay as proof.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- AlterEnum
ALTER TYPE "CaseFileKind" ADD VALUE 'REFUSAL_LETTER';

-- AlterTable
ALTER TABLE "CaseFile" ADD COLUMN     "travellerId" TEXT;

-- CreateIndex
CREATE INDEX "CaseFile_travellerId_uploadedAt_idx" ON "CaseFile"("travellerId", "uploadedAt");

-- AddForeignKey
ALTER TABLE "CaseFile" ADD CONSTRAINT "CaseFile_travellerId_fkey" FOREIGN KEY ("travellerId") REFERENCES "VisaCaseTraveller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written (Prisma can't express these).

-- A refusal letter is for one traveller, and only a refusal letter has one. The kind is compared as text: Postgres
-- doesn't allow the new enum value itself until this migration is committed.
ALTER TABLE "CaseFile" ADD CONSTRAINT "CaseFile_refusal_letter_traveller" CHECK (("kind"::text = 'REFUSAL_LETTER') = ("travellerId" IS NOT NULL));
