-- Visa Step 5, "Submitted at the embassy" (docs/decisions/0011-visa-at-vendor.md Decisions 3 and 4): the vendor's file
-- number, the embassy the file went to and the expected collection date, saved together, with who first saved them.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- AlterTable
ALTER TABLE "VisaCase" ADD COLUMN     "collectionOn" DATE,
ADD COLUMN     "embassyId" INTEGER,
ADD COLUMN     "submittedAt" TIMESTAMPTZ(3),
ADD COLUMN     "submittedById" TEXT,
ADD COLUMN     "vendorFileNo" TEXT;

-- CreateIndex
CREATE INDEX "VisaCase_embassyId_idx" ON "VisaCase"("embassyId");

-- AddForeignKey
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_embassyId_fkey" FOREIGN KEY ("embassyId") REFERENCES "Embassy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The five are saved together or not at all; a file is submitted only once the vendor has it; the file number is
-- capitals, digits, "-" and "/", 3–40, starting with a letter or digit.
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_submission_together" CHECK (
  ("submittedAt" IS NULL AND "submittedById" IS NULL AND "vendorFileNo" IS NULL AND "embassyId" IS NULL AND "collectionOn" IS NULL)
  OR ("submittedAt" IS NOT NULL AND "submittedById" IS NOT NULL AND "vendorFileNo" IS NOT NULL AND "embassyId" IS NOT NULL AND "collectionOn" IS NOT NULL)
);
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_submitted_after_received" CHECK ("submittedAt" IS NULL OR "vendorReceivedAt" IS NOT NULL);
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_vendor_file_no_format" CHECK ("vendorFileNo" IS NULL OR "vendorFileNo" ~ '^[A-Z0-9][A-Z0-9/-]{2,39}$');
