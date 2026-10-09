-- CreateEnum
CREATE TYPE "EnquiryStatus" AS ENUM ('OPEN', 'POSTPONED', 'CANCELLED', 'LOST', 'CLOSED');

-- CreateEnum
CREATE TYPE "EnquiryOrigin" AS ENUM ('STAFF', 'WHATSAPP_BOT', 'WEBSITE_FORM', 'CROSS_SELL', 'IMPORT');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'RECEIVED', 'MADE', 'NOT_NEEDED');

-- CreateEnum
CREATE TYPE "ReceivedAs" AS ENUM ('ORIGINAL', 'XEROX');

-- Visa Step 1 (intake) and the shared enquiries list: docs/decisions/0003-visa-intake.md (refreshed 9 Oct 2026).
-- (prisma migrate diff also proposed dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- AlterTable: case-number prefixes. Existing departments are backfilled from their code; new ones must set it.
ALTER TABLE "Department" ADD COLUMN     "casePrefix" TEXT;
UPDATE "Department" SET "casePrefix" = CASE "code"
  WHEN 'VISA' THEN 'VISA'
  WHEN 'HOLIDAYS' THEN 'HOL'
  WHEN 'HOTELS' THEN 'HOT'
  WHEN 'INSURANCE' THEN 'INS'
  WHEN 'TICKETS' THEN 'TKT'
  WHEN 'ACCOUNTS' THEN 'ACC'
  ELSE "code"
END;
ALTER TABLE "Department" ALTER COLUMN "casePrefix" SET NOT NULL;

-- CreateTable
CREATE TABLE "DepartmentStage" (
    "id" SERIAL NOT NULL,
    "departmentId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "statusLabel" TEXT NOT NULL,
    "nextStepLabel" TEXT NOT NULL,

    CONSTRAINT "DepartmentStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseCounter" (
    "departmentId" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CaseCounter_pkey" PRIMARY KEY ("departmentId","year")
);

-- CreateTable
CREATE TABLE "EnquirySource" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "staffSelectable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "EnquirySource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Enquiry" (
    "id" TEXT NOT NULL,
    "caseNo" TEXT NOT NULL,
    "departmentId" INTEGER NOT NULL,
    "clientId" TEXT NOT NULL,
    "sourceId" INTEGER NOT NULL,
    "origin" "EnquiryOrigin" NOT NULL DEFAULT 'STAFF',
    "idempotencyKey" TEXT,
    "stageId" INTEGER NOT NULL,
    "status" "EnquiryStatus" NOT NULL DEFAULT 'OPEN',
    "ownerId" TEXT,
    "dueAt" TIMESTAMPTZ(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Enquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisaCase" (
    "enquiryId" TEXT NOT NULL,
    "offeringId" INTEGER NOT NULL,
    "travelMonth" DATE NOT NULL,
    "travelDate" DATE,

    CONSTRAINT "VisaCase_pkey" PRIMARY KEY ("enquiryId")
);

-- CreateTable
CREATE TABLE "VisaCaseTraveller" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "isChild" BOOLEAN NOT NULL,
    "name" TEXT,

    CONSTRAINT "VisaCaseTraveller_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisaCaseDocument" (
    "id" TEXT NOT NULL,
    "travellerId" TEXT NOT NULL,
    "documentId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "detail" TEXT,
    "requirement" "DocumentRequirement" NOT NULL,
    "quantity" SMALLINT NOT NULL DEFAULT 1,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "receivedAs" "ReceivedAs",
    "receivedAt" TIMESTAMPTZ(3),
    "receivedById" TEXT,

    CONSTRAINT "VisaCaseDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DepartmentStage_departmentId_code_key" ON "DepartmentStage"("departmentId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "DepartmentStage_departmentId_sortOrder_key" ON "DepartmentStage"("departmentId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "EnquirySource_code_key" ON "EnquirySource"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Enquiry_caseNo_key" ON "Enquiry"("caseNo");

-- CreateIndex
CREATE UNIQUE INDEX "Enquiry_idempotencyKey_key" ON "Enquiry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Enquiry_status_dueAt_idx" ON "Enquiry"("status", "dueAt");

-- CreateIndex
CREATE INDEX "Enquiry_departmentId_status_dueAt_idx" ON "Enquiry"("departmentId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "Enquiry_ownerId_status_dueAt_idx" ON "Enquiry"("ownerId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "Enquiry_clientId_idx" ON "Enquiry"("clientId");

-- CreateIndex
CREATE INDEX "VisaCase_offeringId_idx" ON "VisaCase"("offeringId");

-- CreateIndex
CREATE UNIQUE INDEX "VisaCaseTraveller_caseId_position_key" ON "VisaCaseTraveller"("caseId", "position");

-- CreateIndex
CREATE INDEX "VisaCaseDocument_documentId_status_idx" ON "VisaCaseDocument"("documentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "VisaCaseDocument_travellerId_documentId_key" ON "VisaCaseDocument"("travellerId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "Department_casePrefix_key" ON "Department"("casePrefix");

-- AddForeignKey
ALTER TABLE "DepartmentStage" ADD CONSTRAINT "DepartmentStage_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseCounter" ADD CONSTRAINT "CaseCounter_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "EnquirySource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "DepartmentStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "VisaOffering"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisaCaseTraveller" ADD CONSTRAINT "VisaCaseTraveller_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "VisaCase"("enquiryId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisaCaseDocument" ADD CONSTRAINT "VisaCaseDocument_travellerId_fkey" FOREIGN KEY ("travellerId") REFERENCES "VisaCaseTraveller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisaCaseDocument" ADD CONSTRAINT "VisaCaseDocument_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DocumentMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisaCaseDocument" ADD CONSTRAINT "VisaCaseDocument_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Checks the schema can't express
ALTER TABLE "Department" ADD CONSTRAINT "Department_casePrefix_format" CHECK ("casePrefix" ~ '^[A-Z]{2,8}$');
ALTER TABLE "EnquirySource" ADD CONSTRAINT "EnquirySource_code_format" CHECK ("code" ~ '^[A-Z0-9_]{1,40}$');
ALTER TABLE "DepartmentStage" ADD CONSTRAINT "DepartmentStage_sortOrder_positive" CHECK ("sortOrder" >= 1);
ALTER TABLE "CaseCounter" ADD CONSTRAINT "CaseCounter_lastValue_positive" CHECK ("lastValue" >= 0);
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_travelMonth_first" CHECK (EXTRACT(DAY FROM "travelMonth") = 1);
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_travelDate_in_month" CHECK (
  "travelDate" IS NULL OR date_trunc('month', "travelDate")::date = "travelMonth"
);
ALTER TABLE "VisaCaseTraveller" ADD CONSTRAINT "VisaCaseTraveller_position_positive" CHECK ("position" >= 1);
ALTER TABLE "VisaCaseDocument" ADD CONSTRAINT "VisaCaseDocument_quantity_range" CHECK ("quantity" BETWEEN 1 AND 20);
