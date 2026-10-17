-- The field staff app, phase 1 (docs/decisions/0015-field-staff-app.md): the collection and delivery boy's time slots
-- (a list), and the field job filled out: what it is, for which case, who goes, on which day and slot, where to (the
-- address, and the client's Google Maps link if they shared one), the client's mobile, who booked it, and whether it
-- was called off. No FieldJob rows exist outside the tests yet, so the required columns need no default.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- CreateEnum
CREATE TYPE "FieldJobKind" AS ENUM ('PICKUP', 'DELIVERY');

-- CreateEnum
CREATE TYPE "FieldJobStatus" AS ENUM ('BOOKED', 'DONE', 'FAILED', 'CANCELLED');

-- DropIndex
DROP INDEX "FieldJob_assigneeId_idx";

-- AlterTable
ALTER TABLE "FieldJob" ADD COLUMN     "address" TEXT NOT NULL,
ADD COLUMN     "cancelledAt" TIMESTAMPTZ(3),
ADD COLUMN     "cancelledById" TEXT,
ADD COLUMN     "createdById" TEXT NOT NULL,
ADD COLUMN     "day" DATE NOT NULL,
ADD COLUMN     "enquiryId" TEXT NOT NULL,
ADD COLUMN     "kind" "FieldJobKind" NOT NULL,
ADD COLUMN     "mapLink" TEXT,
ADD COLUMN     "mobile" TEXT NOT NULL,
ADD COLUMN     "slotId" INTEGER NOT NULL,
ADD COLUMN     "status" "FieldJobStatus" NOT NULL DEFAULT 'BOOKED',
ALTER COLUMN "assigneeId" SET NOT NULL;

-- CreateTable
CREATE TABLE "FieldSlot" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsAt" TEXT NOT NULL,
    "endsAt" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "FieldSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FieldSlot_code_key" ON "FieldSlot"("code");

-- CreateIndex
CREATE INDEX "FieldJob_assigneeId_day_idx" ON "FieldJob"("assigneeId", "day");

-- CreateIndex
CREATE INDEX "FieldJob_enquiryId_idx" ON "FieldJob"("enquiryId");

-- AddForeignKey
ALTER TABLE "FieldJob" ADD CONSTRAINT "FieldJob_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldJob" ADD CONSTRAINT "FieldJob_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "FieldSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldJob" ADD CONSTRAINT "FieldJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldJob" ADD CONSTRAINT "FieldJob_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written (Prisma can't express these).

-- A slot's code follows the other lists' format; its name isn't blank; its times are 24-hour "HH:mm" (IST), ending
-- after they start.
ALTER TABLE "FieldSlot" ADD CONSTRAINT "FieldSlot_code_format" CHECK ("code" ~ '^[A-Z0-9_]{1,40}$');
ALTER TABLE "FieldSlot" ADD CONSTRAINT "FieldSlot_name_not_blank" CHECK (btrim("name") <> '');
ALTER TABLE "FieldSlot" ADD CONSTRAINT "FieldSlot_times" CHECK (
  "startsAt" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "endsAt" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "endsAt" > "startsAt"
);

-- Where he goes and whom he calls are never blank; a map link is a web address. Called off: who and when, together, and
-- only then.
ALTER TABLE "FieldJob" ADD CONSTRAINT "FieldJob_address_mobile" CHECK (btrim("address") <> '' AND btrim("mobile") <> '');
ALTER TABLE "FieldJob" ADD CONSTRAINT "FieldJob_map_link" CHECK ("mapLink" IS NULL OR ("mapLink" ~ '^https://' AND char_length("mapLink") <= 500));
ALTER TABLE "FieldJob" ADD CONSTRAINT "FieldJob_cancelled" CHECK (
  ("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL) AND ("cancelledAt" IS NULL) = ("cancelledById" IS NULL)
);
