-- How urgent each visa case is (docs/decisions/0003-visa-intake.md amendment 1, change request 17): required, picked on
-- New enquiry. No backfill (CLAUDE.md: still in development), so a database that already has visa cases needs
-- `npx prisma migrate reset`, then `npm run db:seed`.

-- AlterTable
ALTER TABLE "VisaCase" ADD COLUMN     "urgencyId" INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX "VisaCase_urgencyId_idx" ON "VisaCase"("urgencyId");

-- AddForeignKey
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_urgencyId_fkey" FOREIGN KEY ("urgencyId") REFERENCES "UrgencyLevel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
