-- 0011 component 3c (docs/decisions/0011-visa-at-vendor.md Decision 5): the replacement invoice. Once a WHOLE credit note
-- cancels a wrong invoice, a corrected one is raised from the corrected quote, pointing at the one it replaces. A case
-- has one chain: one original, each replacement replacing one cancelled invoice of the same case, so only the last one
-- stands. The replacement isn't the file's one additional invoice (M37).
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- DropIndex
DROP INDEX "Invoice_enquiryId_key";

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "replacesId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_replacesId_key" ON "Invoice"("replacesId");

-- CreateIndex
CREATE INDEX "Invoice_enquiryId_idx" ON "Invoice"("enquiryId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_replacesId_fkey" FOREIGN KEY ("replacesId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One original invoice per case; every other one is a replacement.
CREATE UNIQUE INDEX "Invoice_one_original_per_case" ON "Invoice"("enquiryId") WHERE "replacesId" IS NULL;

-- A replacement replaces an invoice of its own case that a WHOLE credit note has cancelled.
CREATE OR REPLACE FUNCTION invoice_replaces_cancelled() RETURNS trigger AS $$
BEGIN
  IF NEW."replacesId" IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Invoice" WHERE "id" = NEW."replacesId" AND "enquiryId" = NEW."enquiryId") THEN
    RAISE EXCEPTION 'A replacement invoice must replace an invoice of the same case';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "CreditNote" WHERE "invoiceId" = NEW."replacesId" AND "kind" = 'WHOLE') THEN
    RAISE EXCEPTION 'An invoice can only be replaced once a credit note has cancelled it';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Invoice_replaces_cancelled"
  BEFORE INSERT ON "Invoice"
  FOR EACH ROW EXECUTE FUNCTION invoice_replaces_cancelled();
