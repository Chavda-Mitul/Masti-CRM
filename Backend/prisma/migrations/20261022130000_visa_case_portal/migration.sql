-- "Log in for me" on the visa case (docs/decisions/0024-portal-logins.md, component 3): each visa (country × type) can
-- name the government portal its cases open, and a press records the case it was made on.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- AlterTable
ALTER TABLE "PortalLoginUse" ADD COLUMN     "enquiryId" TEXT;

-- AlterTable
ALTER TABLE "VisaOffering" ADD COLUMN     "portalLoginId" TEXT;

-- CreateIndex
CREATE INDEX "PortalLoginUse_enquiryId_idx" ON "PortalLoginUse"("enquiryId");

-- CreateIndex
CREATE INDEX "VisaOffering_portalLoginId_idx" ON "VisaOffering"("portalLoginId");

-- AddForeignKey
ALTER TABLE "VisaOffering" ADD CONSTRAINT "VisaOffering_portalLoginId_fkey" FOREIGN KEY ("portalLoginId") REFERENCES "PortalLogin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalLoginUse" ADD CONSTRAINT "PortalLoginUse_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

