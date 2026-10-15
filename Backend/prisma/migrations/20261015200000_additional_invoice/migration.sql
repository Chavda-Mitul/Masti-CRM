-- 0011 component 5b (docs/decisions/0011-visa-at-vendor.md Decision 7): the one additional invoice per file. "MVI…-A",
-- for extra charges picked from the list, with no GST. A case keeps one original MAIN invoice and at most one original
-- ADDITIONAL one (a replacement of either comes with 5c).
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('MAIN', 'ADDITIONAL');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "kind" "InvoiceKind" NOT NULL DEFAULT 'MAIN';

-- CreateTable
CREATE TABLE "InvoiceCharge" (
    "invoiceId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "chargeId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,

    CONSTRAINT "InvoiceCharge_pkey" PRIMARY KEY ("invoiceId","position")
);

-- CreateIndex
CREATE INDEX "InvoiceCharge_chargeId_idx" ON "InvoiceCharge"("chargeId");

-- AddForeignKey
ALTER TABLE "InvoiceCharge" ADD CONSTRAINT "InvoiceCharge_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceCharge" ADD CONSTRAINT "InvoiceCharge_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "ExtraCharge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One original of each kind per case; every other invoice is a replacement.
DROP INDEX "Invoice_one_original_per_case";
CREATE UNIQUE INDEX "Invoice_one_original_per_case" ON "Invoice"("enquiryId") WHERE "replacesId" IS NULL AND "kind" = 'MAIN';
CREATE UNIQUE INDEX "Invoice_one_original_additional_per_case" ON "Invoice"("enquiryId") WHERE "replacesId" IS NULL AND "kind" = 'ADDITIONAL';

-- An additional invoice charges no service charge and no GST (decided 15 Oct 2026; M38(a) to confirm).
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_additional_no_gst" CHECK (
  "kind" = 'MAIN' OR ("serviceChargePaise" = 0 AND "cgstPaise" = 0 AND "sgstPaise" = 0 AND "igstPaise" = 0 AND "gstRateBp" = 0)
);

-- A replacement replaces a cancelled invoice of its own case and its own kind. Replaces the function of
-- 20261015160000_replacement_invoice, keeping its checks.
CREATE OR REPLACE FUNCTION invoice_replaces_cancelled() RETURNS trigger AS $$
BEGIN
  IF NEW."replacesId" IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Invoice" WHERE "id" = NEW."replacesId" AND "enquiryId" = NEW."enquiryId") THEN
    RAISE EXCEPTION 'A replacement invoice must replace an invoice of the same case';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Invoice" WHERE "id" = NEW."replacesId" AND "kind" = NEW."kind") THEN
    RAISE EXCEPTION 'A replacement invoice must replace an invoice of the same kind';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "CreditNote" WHERE "invoiceId" = NEW."replacesId" AND "kind" = 'WHOLE') THEN
    RAISE EXCEPTION 'An invoice can only be replaced once a credit note has cancelled it';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- An extra charge is never edited, is above 0 and at most ₹10 lakh (a sanity limit), and sits only on an ADDITIONAL
-- invoice.
CREATE TRIGGER "InvoiceCharge_never_edited"
  BEFORE UPDATE OR DELETE ON "InvoiceCharge"
  FOR EACH ROW EXECUTE FUNCTION invoice_block_change();

ALTER TABLE "InvoiceCharge" ADD CONSTRAINT "InvoiceCharge_amount_range" CHECK ("amountPaise" > 0 AND "amountPaise" <= 100000000);
ALTER TABLE "InvoiceCharge" ADD CONSTRAINT "InvoiceCharge_position_positive" CHECK ("position" >= 1);

CREATE OR REPLACE FUNCTION invoice_charge_on_additional() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Invoice" WHERE "id" = NEW."invoiceId" AND "kind" = 'ADDITIONAL') THEN
    RAISE EXCEPTION 'Extra charges go only on an additional invoice';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "InvoiceCharge_on_additional"
  BEFORE INSERT ON "InvoiceCharge"
  FOR EACH ROW EXECUTE FUNCTION invoice_charge_on_additional();
