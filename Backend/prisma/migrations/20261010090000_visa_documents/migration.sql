-- Visa Step 2 (docs/decisions/0006-visa-documents.md): follow-up and reason masters, the follow-up log, consent,
-- traveller ↔ family member links, how documents arrive, booklets, and maturity.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- CreateEnum
CREATE TYPE "EnquiryReasonKind" AS ENUM ('POSTPONE', 'CANCEL');

-- CreateEnum
CREATE TYPE "DocumentArrival" AS ENUM ('CLIENT_BRINGS', 'COLLECTION_BOY');

-- AlterTable
ALTER TABLE "Enquiry" ADD COLUMN     "reasonId" INTEGER,
ADD COLUMN     "resumeOn" DATE;

-- AlterTable
ALTER TABLE "VisaCase" ADD COLUMN     "arrival" "DocumentArrival",
ADD COLUMN     "bookletsCurrent" SMALLINT,
ADD COLUMN     "bookletsOld" SMALLINT,
ADD COLUMN     "maturedAt" TIMESTAMPTZ(3),
ADD COLUMN     "maturedById" TEXT;

-- AlterTable
ALTER TABLE "VisaCaseTraveller" ADD COLUMN     "memberId" TEXT;

-- CreateTable
CREATE TABLE "FollowUpOutcome" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "FollowUpOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpNextStep" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "FollowUpNextStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnquiryReason" (
    "id" SERIAL NOT NULL,
    "kind" "EnquiryReasonKind" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "EnquiryReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUp" (
    "id" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "outcomeId" INTEGER NOT NULL,
    "nextStepId" INTEGER NOT NULL,
    "nextAt" TIMESTAMPTZ(3) NOT NULL,
    "byId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consent" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "agreedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FollowUpOutcome_code_key" ON "FollowUpOutcome"("code");

-- CreateIndex
CREATE UNIQUE INDEX "FollowUpNextStep_code_key" ON "FollowUpNextStep"("code");

-- CreateIndex
CREATE UNIQUE INDEX "EnquiryReason_code_key" ON "EnquiryReason"("code");

-- CreateIndex
CREATE INDEX "EnquiryReason_kind_isActive_idx" ON "EnquiryReason"("kind", "isActive");

-- CreateIndex
CREATE INDEX "FollowUp_enquiryId_createdAt_idx" ON "FollowUp"("enquiryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Consent_memberId_key" ON "Consent"("memberId");

-- CreateIndex
CREATE INDEX "VisaCaseTraveller_memberId_idx" ON "VisaCaseTraveller"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "VisaCaseTraveller_caseId_memberId_key" ON "VisaCaseTraveller"("caseId", "memberId");

-- AddForeignKey
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "EnquiryReason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "FollowUpOutcome"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_nextStepId_fkey" FOREIGN KEY ("nextStepId") REFERENCES "FollowUpNextStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_byId_fkey" FOREIGN KEY ("byId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_maturedById_fkey" FOREIGN KEY ("maturedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisaCaseTraveller" ADD CONSTRAINT "VisaCaseTraveller_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "ClientMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "ClientMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Master codes never change and follow one format, as EnquirySource.
ALTER TABLE "FollowUpOutcome" ADD CONSTRAINT "FollowUpOutcome_code_format" CHECK ("code" ~ '^[A-Z0-9_]{1,40}$');
ALTER TABLE "FollowUpNextStep" ADD CONSTRAINT "FollowUpNextStep_code_format" CHECK ("code" ~ '^[A-Z0-9_]{1,40}$');
ALTER TABLE "EnquiryReason" ADD CONSTRAINT "EnquiryReason_code_format" CHECK ("code" ~ '^[A-Z0-9_]{1,40}$');

-- A postponed enquiry has a reason and a resume date; a cancelled one has a reason (0006 Decision 6).
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_postponed_has_reason_and_date"
  CHECK ("status" <> 'POSTPONED' OR ("reasonId" IS NOT NULL AND "resumeOn" IS NOT NULL));
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_cancelled_has_reason"
  CHECK ("status" <> 'CANCELLED' OR "reasonId" IS NOT NULL);

-- Booklets received (current + old passports).
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_booklets_range"
  CHECK (("bookletsCurrent" IS NULL OR "bookletsCurrent" BETWEEN 0 AND 50) AND ("bookletsOld" IS NULL OR "bookletsOld" BETWEEN 0 AND 50));

-- Matured means both when and by whom.
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_matured_pair" CHECK (("maturedAt" IS NULL) = ("maturedById" IS NULL));
