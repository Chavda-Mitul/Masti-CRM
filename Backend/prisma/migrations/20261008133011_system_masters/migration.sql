-- CreateEnum
CREATE TYPE "ApiScope" AS ENUM ('HOLIDAYS_PUSH');

-- CreateEnum
CREATE TYPE "HolidaySource" AS ENUM ('MANUAL', 'AI_BOT');

-- CreateEnum
CREATE TYPE "HolidayStatus" AS ENUM ('PENDING', 'ACTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "HolidayRepeat" AS ENUM ('NONE', 'WEEKLY');

-- CreateEnum
CREATE TYPE "HolidayTargetKind" AS ENUM ('ALL_EMBASSIES', 'COUNTRY', 'EMBASSY', 'MASTI_OFFICE');

-- CreateEnum
CREATE TYPE "DocumentRequirement" AS ENUM ('ORIGINAL', 'XEROX_OK', 'ARRANGED_BY_US');

-- CreateEnum
CREATE TYPE "TravellerGroup" AS ENUM ('ALL', 'ADULTS', 'CHILDREN');

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "apiClientId" TEXT;

-- CreateTable
CREATE TABLE "ApiClient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" "ApiScope"[],
    "allowedIps" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMPTZ(3),
    "lastUsedIp" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "ApiClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Country" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "zone" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Country_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisaType" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "VisaType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Embassy" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "countryId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Embassy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "repeat" "HolidayRepeat" NOT NULL DEFAULT 'NONE',
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "weekday" SMALLINT,
    "status" "HolidayStatus" NOT NULL DEFAULT 'ACTIVE',
    "source" "HolidaySource" NOT NULL DEFAULT 'MANUAL',
    "externalKey" TEXT,
    "reference" TEXT,
    "addedById" TEXT,
    "apiClientId" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HolidayTarget" (
    "id" SERIAL NOT NULL,
    "holidayId" TEXT NOT NULL,
    "kind" "HolidayTargetKind" NOT NULL,
    "countryId" INTEGER,
    "embassyId" INTEGER,

    CONSTRAINT "HolidayTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisaOffering" (
    "id" SERIAL NOT NULL,
    "countryId" INTEGER NOT NULL,
    "visaTypeId" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "VisaOffering_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentMaster" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "detail" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DocumentMaster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisaChecklistItem" (
    "id" SERIAL NOT NULL,
    "offeringId" INTEGER NOT NULL,
    "documentId" INTEGER NOT NULL,
    "requirement" "DocumentRequirement" NOT NULL,
    "appliesTo" "TravellerGroup" NOT NULL DEFAULT 'ALL',
    "quantity" SMALLINT NOT NULL DEFAULT 1,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "VisaChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiClient_name_key" ON "ApiClient"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ApiClient_keyPrefix_key" ON "ApiClient"("keyPrefix");

-- CreateIndex
CREATE UNIQUE INDEX "ApiClient_keyHash_key" ON "ApiClient"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "Country_code_key" ON "Country"("code");

-- CreateIndex
CREATE UNIQUE INDEX "VisaType_code_key" ON "VisaType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Embassy_code_key" ON "Embassy"("code");

-- CreateIndex
CREATE INDEX "Embassy_countryId_idx" ON "Embassy"("countryId");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_externalKey_key" ON "Holiday"("externalKey");

-- CreateIndex
CREATE INDEX "Holiday_status_startDate_idx" ON "Holiday"("status", "startDate");

-- CreateIndex
CREATE INDEX "Holiday_apiClientId_updatedAt_idx" ON "Holiday"("apiClientId", "updatedAt");

-- CreateIndex
CREATE INDEX "HolidayTarget_holidayId_idx" ON "HolidayTarget"("holidayId");

-- CreateIndex
CREATE INDEX "HolidayTarget_kind_countryId_idx" ON "HolidayTarget"("kind", "countryId");

-- CreateIndex
CREATE INDEX "HolidayTarget_kind_embassyId_idx" ON "HolidayTarget"("kind", "embassyId");

-- CreateIndex
CREATE UNIQUE INDEX "VisaOffering_countryId_visaTypeId_key" ON "VisaOffering"("countryId", "visaTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentMaster_code_key" ON "DocumentMaster"("code");

-- CreateIndex
CREATE INDEX "VisaChecklistItem_documentId_idx" ON "VisaChecklistItem"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "VisaChecklistItem_offeringId_documentId_key" ON "VisaChecklistItem"("offeringId", "documentId");

-- CreateIndex
CREATE INDEX "AuditLog_apiClientId_idx" ON "AuditLog"("apiClientId");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_apiClientId_fkey" FOREIGN KEY ("apiClientId") REFERENCES "ApiClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiClient" ADD CONSTRAINT "ApiClient_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Embassy" ADD CONSTRAINT "Embassy_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_apiClientId_fkey" FOREIGN KEY ("apiClientId") REFERENCES "ApiClient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HolidayTarget" ADD CONSTRAINT "HolidayTarget_holidayId_fkey" FOREIGN KEY ("holidayId") REFERENCES "Holiday"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HolidayTarget" ADD CONSTRAINT "HolidayTarget_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HolidayTarget" ADD CONSTRAINT "HolidayTarget_embassyId_fkey" FOREIGN KEY ("embassyId") REFERENCES "Embassy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisaOffering" ADD CONSTRAINT "VisaOffering_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisaOffering" ADD CONSTRAINT "VisaOffering_visaTypeId_fkey" FOREIGN KEY ("visaTypeId") REFERENCES "VisaType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisaChecklistItem" ADD CONSTRAINT "VisaChecklistItem_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "VisaOffering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisaChecklistItem" ADD CONSTRAINT "VisaChecklistItem_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DocumentMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written integrity rules (Prisma can't express these). See docs/decisions/0005-system-masters.md.
-- The services validate the same rules with friendlier messages; these also guard the seed and later writers.
-- ---------------------------------------------------------------------------

-- Codes are stable keys (the bot and the seed use them): stored uppercase.
ALTER TABLE "Country" ADD CONSTRAINT "Country_code_format" CHECK ("code" ~ '^[A-Z]{2}$');
ALTER TABLE "VisaType" ADD CONSTRAINT "VisaType_code_format" CHECK ("code" ~ '^[A-Z0-9_]{1,40}$');
ALTER TABLE "Embassy" ADD CONSTRAINT "Embassy_code_format" CHECK ("code" ~ '^[A-Z0-9-]{2,20}$');
ALTER TABLE "DocumentMaster" ADD CONSTRAINT "DocumentMaster_code_format" CHECK ("code" ~ '^[A-Z0-9_]{1,40}$');

-- A dated holiday has an end on or after its start; a weekly one has a weekday (ISO, 1 = Monday … 7 = Sunday).
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_dates" CHECK (
  ("repeat" = 'NONE' AND "endDate" IS NOT NULL AND "endDate" >= "startDate" AND "weekday" IS NULL)
  OR ("repeat" = 'WEEKLY' AND "weekday" BETWEEN 1 AND 7 AND ("endDate" IS NULL OR "endDate" >= "startDate"))
);

-- Staff (or seeded) entries have no machine account or bot key; bot entries have both and no staff author.
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_source" CHECK (
  ("source" = 'MANUAL' AND "apiClientId" IS NULL AND "externalKey" IS NULL)
  OR ("source" = 'AI_BOT' AND "apiClientId" IS NOT NULL AND "externalKey" IS NOT NULL AND "addedById" IS NULL)
);

-- A target names a country only for COUNTRY, an embassy only for EMBASSY, and nothing otherwise.
ALTER TABLE "HolidayTarget" ADD CONSTRAINT "HolidayTarget_kind_fields" CHECK (
  ("kind" = 'COUNTRY' AND "countryId" IS NOT NULL AND "embassyId" IS NULL)
  OR ("kind" = 'EMBASSY' AND "embassyId" IS NOT NULL AND "countryId" IS NULL)
  OR ("kind" IN ('ALL_EMBASSIES', 'MASTI_OFFICE') AND "countryId" IS NULL AND "embassyId" IS NULL)
);

-- The same target can't be listed twice on one holiday (NULLs count as equal: Postgres 15+).
CREATE UNIQUE INDEX "HolidayTarget_unique" ON "HolidayTarget" ("holidayId", "kind", "countryId", "embassyId") NULLS NOT DISTINCT;

-- "Photos (2)": a sane quantity.
ALTER TABLE "VisaChecklistItem" ADD CONSTRAINT "VisaChecklistItem_quantity" CHECK ("quantity" BETWEEN 1 AND 20);
