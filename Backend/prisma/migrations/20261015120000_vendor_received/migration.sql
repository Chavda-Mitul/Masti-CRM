-- Visa Step 5, "Vendor got it, papers checked" (docs/decisions/0011-visa-at-vendor.md Decision 2): each file sent in a
-- docket is confirmed on its own, with who confirmed it and when.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- AlterTable
ALTER TABLE "VisaCase" ADD COLUMN     "vendorReceivedAt" TIMESTAMPTZ(3),
ADD COLUMN     "vendorReceivedById" TEXT;

-- AddForeignKey
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_vendorReceivedById_fkey" FOREIGN KEY ("vendorReceivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Who and when are set together, and only a file that went in a docket reaches a vendor.
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_vendor_received_pair" CHECK (("vendorReceivedAt" IS NULL) = ("vendorReceivedById" IS NULL));
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_vendor_received_docket" CHECK ("vendorReceivedAt" IS NULL OR "docketId" IS NOT NULL);
