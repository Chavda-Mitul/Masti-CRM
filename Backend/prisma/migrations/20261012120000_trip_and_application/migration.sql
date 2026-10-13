-- Visa Step 3, slice 3 (docs/decisions/0007-visa-file-prep.md Decisions 4, 5 and 6): the case's trip details, each
-- traveller's acknowledgement number and appointment from the portal, and the visa's "Appointment needed" and
-- "Vendor needed" switches (on by default ⚠️, off for e-visas).
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- CreateEnum
CREATE TYPE "EntryType" AS ENUM ('SINGLE', 'DOUBLE', 'MULTIPLE');

-- AlterTable
ALTER TABLE "VisaCase" ADD COLUMN     "departOn" DATE,
ADD COLUMN     "entryType" "EntryType",
ADD COLUMN     "hotelStay" TEXT,
ADD COLUMN     "returnOn" DATE;

-- AlterTable
ALTER TABLE "VisaCaseTraveller" ADD COLUMN     "ackNo" TEXT,
ADD COLUMN     "appointmentAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "VisaOffering" ADD COLUMN     "appointmentNeeded" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "vendorNeeded" BOOLEAN NOT NULL DEFAULT true;

-- Hand-written (Prisma can't express these).

-- Coming back is never before travelling out.
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_trip_dates" CHECK ("returnOn" IS NULL OR "departOn" IS NULL OR "returnOn" >= "departOn");

-- The hotel's name and city: short, and never blank (blank is stored as NULL).
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_hotelStay" CHECK ("hotelStay" IS NULL OR (char_length("hotelStay") <= 200 AND btrim("hotelStay") <> ''));

-- The portal's acknowledgement number: capitals and digits, as cleaned up by the API.
ALTER TABLE "VisaCaseTraveller" ADD CONSTRAINT "VisaCaseTraveller_ackNo_format" CHECK ("ackNo" IS NULL OR "ackNo" ~ '^[A-Z0-9]{4,40}$');

-- Travelling out starts as the intake's exact travel date, if there was one (Decision 4).
UPDATE "VisaCase" SET "departOn" = "travelDate" WHERE "travelDate" IS NOT NULL AND "departOn" IS NULL;
