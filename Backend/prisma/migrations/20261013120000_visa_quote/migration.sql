-- 0009 component 1 (docs/decisions/0009-visa-invoice.md Decision 2): the quote on a visa case, which the invoice will
-- copy. Money is in paise, as integers. Plus the processing-speed master (Normal, Express…) picked on the quote.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- CreateEnum
CREATE TYPE "QuoteForm" AS ENUM ('LUMP_SUM', 'ITEMISED');

-- CreateTable
CREATE TABLE "ProcessingSpeed" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ProcessingSpeed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisaQuote" (
    "enquiryId" TEXT NOT NULL,
    "processingSpeedId" INTEGER NOT NULL,
    "serviceChargePaise" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "VisaQuote_pkey" PRIMARY KEY ("enquiryId")
);

-- CreateTable
CREATE TABLE "VisaQuoteLine" (
    "travellerId" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "form" "QuoteForm" NOT NULL,
    "lumpSumPaise" INTEGER,
    "embassyFeePaise" INTEGER,
    "vfsFeePaise" INTEGER,
    "otherFeePaise" INTEGER,

    CONSTRAINT "VisaQuoteLine_pkey" PRIMARY KEY ("travellerId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcessingSpeed_code_key" ON "ProcessingSpeed"("code");

-- CreateIndex
CREATE INDEX "VisaQuote_processingSpeedId_idx" ON "VisaQuote"("processingSpeedId");

-- CreateIndex
CREATE INDEX "VisaQuote_updatedById_idx" ON "VisaQuote"("updatedById");

-- CreateIndex
CREATE INDEX "VisaQuoteLine_enquiryId_idx" ON "VisaQuoteLine"("enquiryId");

-- AddForeignKey
ALTER TABLE "VisaQuote" ADD CONSTRAINT "VisaQuote_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "VisaCase"("enquiryId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisaQuote" ADD CONSTRAINT "VisaQuote_processingSpeedId_fkey" FOREIGN KEY ("processingSpeedId") REFERENCES "ProcessingSpeed"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisaQuote" ADD CONSTRAINT "VisaQuote_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisaQuoteLine" ADD CONSTRAINT "VisaQuoteLine_travellerId_fkey" FOREIGN KEY ("travellerId") REFERENCES "VisaCaseTraveller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisaQuoteLine" ADD CONSTRAINT "VisaQuoteLine_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "VisaQuote"("enquiryId") ON DELETE CASCADE ON UPDATE CASCADE;


-- Amounts: 0 to 10,00,00,000 paise (₹10,00,000) each, a sanity limit.
ALTER TABLE "VisaQuote" ADD CONSTRAINT "VisaQuote_serviceCharge_range" CHECK ("serviceChargePaise" BETWEEN 0 AND 100000000);
ALTER TABLE "VisaQuoteLine" ADD CONSTRAINT "VisaQuoteLine_amounts_range" CHECK (
  ("lumpSumPaise" IS NULL OR "lumpSumPaise" BETWEEN 0 AND 100000000) AND
  ("embassyFeePaise" IS NULL OR "embassyFeePaise" BETWEEN 0 AND 100000000) AND
  ("vfsFeePaise" IS NULL OR "vfsFeePaise" BETWEEN 0 AND 100000000) AND
  ("otherFeePaise" IS NULL OR "otherFeePaise" BETWEEN 0 AND 100000000)
);

-- A lump sum has only the lump sum; itemised has the three fees (0 allowed) and no lump sum.
ALTER TABLE "VisaQuoteLine" ADD CONSTRAINT "VisaQuoteLine_form_amounts" CHECK (
  ("form" = 'LUMP_SUM' AND "lumpSumPaise" IS NOT NULL AND "embassyFeePaise" IS NULL AND "vfsFeePaise" IS NULL AND "otherFeePaise" IS NULL) OR
  ("form" = 'ITEMISED' AND "lumpSumPaise" IS NULL AND "embassyFeePaise" IS NOT NULL AND "vfsFeePaise" IS NOT NULL AND "otherFeePaise" IS NOT NULL)
);

ALTER TABLE "ProcessingSpeed" ADD CONSTRAINT "ProcessingSpeed_code_format" CHECK ("code" ~ '^[A-Z0-9_]{1,40}$');
