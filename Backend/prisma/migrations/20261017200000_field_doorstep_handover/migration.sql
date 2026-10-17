-- 0015 phase 5, the doorstep handover (docs/decisions/0015-field-staff-app.md Decision 4): a handover at the client's door
-- points at the delivery boy's field job (the client's code, his selfie, the place). Both kinds of handover photograph
-- the person receiving, so the photo is required.

-- AlterTable
ALTER TABLE "VisaHandover" ADD COLUMN     "fieldJobId" TEXT,
ALTER COLUMN "receiverPhotoId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "VisaHandover_fieldJobId_key" ON "VisaHandover"("fieldJobId");

-- AddForeignKey
ALTER TABLE "VisaHandover" ADD CONSTRAINT "VisaHandover_fieldJobId_fkey" FOREIGN KEY ("fieldJobId") REFERENCES "FieldJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written (Prisma can't express these).

-- The photo is now required for both kinds (NOT NULL above), so the office's own check goes.
ALTER TABLE "VisaHandover" DROP CONSTRAINT "VisaHandover_office_photo";

-- A handover at the door points at the delivery boy's job, and only one at the door does.
ALTER TABLE "VisaHandover" ADD CONSTRAINT "VisaHandover_field_job" CHECK (("mode" = 'DELIVERY') = ("fieldJobId" IS NOT NULL));
