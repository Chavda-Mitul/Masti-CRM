-- 0009 component 3 (docs/decisions/0009-visa-invoice.md): the visa tax invoice, copied from the case's quote and never
-- edited, its lines, the invoice number counter, and the INVOICE kind of case file for its PDF.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- CreateEnum
CREATE TYPE "InvoiceTaxType" AS ENUM ('INTRA_STATE', 'INTER_STATE');

-- AlterEnum
ALTER TYPE "CaseFileKind" ADD VALUE 'INVOICE';

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "issuedOn" DATE NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT NOT NULL,
    "client" JSONB NOT NULL,
    "company" JSONB NOT NULL,
    "terms" JSONB NOT NULL,
    "placeOfSupply" CHAR(2) NOT NULL,
    "taxType" "InvoiceTaxType" NOT NULL,
    "sac" TEXT NOT NULL,
    "gstRateBp" INTEGER NOT NULL,
    "processingSpeed" TEXT NOT NULL,
    "grossPaise" INTEGER NOT NULL,
    "serviceChargePaise" INTEGER NOT NULL,
    "cgstPaise" INTEGER NOT NULL,
    "sgstPaise" INTEGER NOT NULL,
    "igstPaise" INTEGER NOT NULL,
    "totalPaise" INTEGER NOT NULL,
    "fileId" TEXT NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "invoiceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "travellerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "form" "QuoteForm" NOT NULL,
    "lumpSumPaise" INTEGER,
    "embassyFeePaise" INTEGER,
    "vfsFeePaise" INTEGER,
    "otherFeePaise" INTEGER,
    "totalPaise" INTEGER NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("invoiceId","position")
);

-- CreateTable
CREATE TABLE "InvoiceCounter" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "lastValue" INTEGER NOT NULL,

    CONSTRAINT "InvoiceCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNo_key" ON "Invoice"("invoiceNo");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_enquiryId_key" ON "Invoice"("enquiryId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_fileId_key" ON "Invoice"("fileId");

-- CreateIndex
CREATE INDEX "Invoice_issuedById_idx" ON "Invoice"("issuedById");

-- CreateIndex
CREATE INDEX "InvoiceLine_travellerId_idx" ON "InvoiceLine"("travellerId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "CaseFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_travellerId_fkey" FOREIGN KEY ("travellerId") REFERENCES "VisaCaseTraveller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- An invoice is never edited (golden rule 3): any UPDATE or DELETE of an invoice or its lines is refused at the
-- database. Corrections go through a credit note or the one additional invoice (Step 5). TRUNCATE (test setup only)
-- still works, as for the audit log.
CREATE OR REPLACE FUNCTION invoice_block_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is never edited: % is not allowed', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Invoice_never_edited"
  BEFORE UPDATE OR DELETE ON "Invoice"
  FOR EACH ROW EXECUTE FUNCTION invoice_block_change();

CREATE TRIGGER "InvoiceLine_never_edited"
  BEFORE UPDATE OR DELETE ON "InvoiceLine"
  FOR EACH ROW EXECUTE FUNCTION invoice_block_change();

-- The totals add up, the tax matches its type, and nothing is negative.
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_amounts_nonnegative" CHECK (
  "grossPaise" >= 0 AND "serviceChargePaise" >= 0 AND "cgstPaise" >= 0 AND "sgstPaise" >= 0 AND "igstPaise" >= 0 AND "gstRateBp" >= 0
);
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_total_adds_up" CHECK (
  "totalPaise" = "grossPaise" + "serviceChargePaise" + "cgstPaise" + "sgstPaise" + "igstPaise"
);
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tax_matches_type" CHECK (
  ("taxType" = 'INTRA_STATE' AND "igstPaise" = 0) OR ("taxType" = 'INTER_STATE' AND "cgstPaise" = 0 AND "sgstPaise" = 0)
);

-- A line's amounts match its form, as on the quote, and add up.
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_form_amounts" CHECK (
  ("form" = 'LUMP_SUM' AND "lumpSumPaise" IS NOT NULL AND "embassyFeePaise" IS NULL AND "vfsFeePaise" IS NULL AND "otherFeePaise" IS NULL
     AND "totalPaise" = "lumpSumPaise") OR
  ("form" = 'ITEMISED' AND "lumpSumPaise" IS NULL AND "embassyFeePaise" IS NOT NULL AND "vfsFeePaise" IS NOT NULL AND "otherFeePaise" IS NOT NULL
     AND "totalPaise" = "embassyFeePaise" + "vfsFeePaise" + "otherFeePaise")
);
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_position_positive" CHECK ("position" >= 1);

-- One counter row.
ALTER TABLE "InvoiceCounter" ADD CONSTRAINT "InvoiceCounter_single_row" CHECK ("id" = 1);
ALTER TABLE "InvoiceCounter" ADD CONSTRAINT "InvoiceCounter_lastValue_positive" CHECK ("lastValue" >= 1);
