-- Visa Step 3, slice 4 (docs/decisions/0007-visa-file-prep.md Decision 7): the vendor picked for the case during File
-- preparation. Restrict: a vendor is switched off, never deleted, so the case keeps the one it picked.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- AlterTable
ALTER TABLE "VisaCase" ADD COLUMN     "vendorId" INTEGER;

-- CreateIndex
CREATE INDEX "VisaCase_vendorId_idx" ON "VisaCase"("vendorId");

-- AddForeignKey
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
