-- Visa Step 3, slice 5 (docs/decisions/0007-visa-file-prep.md Decision 9): "File ready — add to docket". Who closed
-- Step 3 and when; the case then moves to Docket & dispatch.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- AlterTable
ALTER TABLE "VisaCase" ADD COLUMN     "fileReadyAt" TIMESTAMPTZ(3),
ADD COLUMN     "fileReadyById" TEXT;

-- CreateIndex
CREATE INDEX "VisaCase_fileReadyById_idx" ON "VisaCase"("fileReadyById");

-- AddForeignKey
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_fileReadyById_fkey" FOREIGN KEY ("fileReadyById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Who and when go together.
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_file_ready_pair" CHECK (("fileReadyAt" IS NULL) = ("fileReadyById" IS NULL));
