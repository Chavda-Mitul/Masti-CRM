-- 0011 component 4b (docs/decisions/0011-visa-at-vendor.md Decision 6): taking a file back from the vendor. Who recalled
-- it, when and why are kept on the case; a PART credit note gives back the embassy fee (or more, if the HOD allows).
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- AlterTable
ALTER TABLE "VisaCase" ADD COLUMN     "recallReasonId" INTEGER,
ADD COLUMN     "recalledAt" TIMESTAMPTZ(3),
ADD COLUMN     "recalledById" TEXT;

-- AddForeignKey
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_recalledById_fkey" FOREIGN KEY ("recalledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_recallReasonId_fkey" FOREIGN KEY ("recallReasonId") REFERENCES "RecallReason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Who, when and why are set together, and only a file that went to a vendor in a docket is recalled.
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_recall_together" CHECK (
  ("recalledAt" IS NULL AND "recalledById" IS NULL AND "recallReasonId" IS NULL)
  OR ("recalledAt" IS NOT NULL AND "recalledById" IS NOT NULL AND "recallReasonId" IS NOT NULL)
);
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_recall_docket" CHECK ("recalledAt" IS NULL OR "docketId" IS NOT NULL);

-- The credit notes on an invoice never give back more than it charged (0011 Decision 5), whole or part: so a WHOLE one
-- can't follow a PART one. Replaces the function of 20261015150000_credit_notes, keeping its checks.
CREATE OR REPLACE FUNCTION credit_note_matches_invoice() RETURNS trigger AS $$
DECLARE
  inv "Invoice"%ROWTYPE;
  credited INTEGER;
BEGIN
  SELECT * INTO inv FROM "Invoice" WHERE "id" = NEW."invoiceId";
  IF inv."enquiryId" IS DISTINCT FROM NEW."enquiryId" THEN
    RAISE EXCEPTION 'A credit note must be on its invoice''s case';
  END IF;
  IF NEW."kind" = 'WHOLE' AND (NEW."grossPaise", NEW."serviceChargePaise", NEW."cgstPaise", NEW."sgstPaise", NEW."igstPaise", NEW."totalPaise")
       IS DISTINCT FROM (inv."grossPaise", inv."serviceChargePaise", inv."cgstPaise", inv."sgstPaise", inv."igstPaise", inv."totalPaise") THEN
    RAISE EXCEPTION 'A whole credit note must give back exactly what its invoice charged';
  END IF;
  SELECT COALESCE(SUM("totalPaise"), 0) INTO credited FROM "CreditNote" WHERE "invoiceId" = NEW."invoiceId";
  IF credited + NEW."totalPaise" > inv."totalPaise" THEN
    RAISE EXCEPTION 'Credit notes can''t give back more than their invoice charged';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
