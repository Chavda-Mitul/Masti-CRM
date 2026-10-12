-- Vendor master (docs/decisions/0007-visa-file-prep.md Decision 7): visa submission agents and the countries they cover.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- CreateEnum
CREATE TYPE "VendorKind" AS ENUM ('VISA_AGENT');

-- CreateTable
CREATE TABLE "Vendor" (
    "id" SERIAL NOT NULL,
    "kind" "VendorKind" NOT NULL DEFAULT 'VISA_AGENT',
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "contactName" TEXT,
    "mobile" TEXT,
    "email" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorCountry" (
    "vendorId" INTEGER NOT NULL,
    "countryId" INTEGER NOT NULL,

    CONSTRAINT "VendorCountry_pkey" PRIMARY KEY ("vendorId","countryId")
);

-- CreateIndex
CREATE INDEX "VendorCountry_countryId_idx" ON "VendorCountry"("countryId");

-- AddForeignKey
ALTER TABLE "VendorCountry" ADD CONSTRAINT "VendorCountry_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorCountry" ADD CONSTRAINT "VendorCountry_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written (Prisma can't express these). prisma migrate diff will propose dropping the index; it stays.

-- One vendor per kind, name and city, whatever the capitals: "Global Visa" and "GLOBAL VISA" in Mumbai are one vendor.
CREATE UNIQUE INDEX "Vendor_kind_name_city_unique" ON "Vendor" ("kind", lower("name"), lower("city"));

-- A name and a city are always there.
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_name_city_not_blank" CHECK (btrim("name") <> '' AND btrim("city") <> '');
