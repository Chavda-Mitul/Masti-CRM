-- 0011 component 3b (docs/decisions/0011-visa-at-vendor.md Decision 5): the credit note. A wrong invoice is never
-- changed: a WHOLE credit note cancels it, giving back exactly what it charged, its GST included. PART credit notes
-- (a recall, component 4) carry no GST. Numbered in their own series, never edited.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- CreateEnum
CREATE TYPE "CreditNoteKind" AS ENUM ('WHOLE', 'PART');

-- AlterEnum
ALTER TYPE "CaseFileKind" ADD VALUE 'CREDIT_NOTE';


-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "creditNoteNo" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "kind" "CreditNoteKind" NOT NULL,
    "reasonId" INTEGER NOT NULL,
    "issuedOn" DATE NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedById" TEXT NOT NULL,
    "client" JSONB NOT NULL,
    "company" JSONB NOT NULL,
    "grossPaise" INTEGER NOT NULL,
    "serviceChargePaise" INTEGER NOT NULL,
    "cgstPaise" INTEGER NOT NULL,
    "sgstPaise" INTEGER NOT NULL,
    "igstPaise" INTEGER NOT NULL,
    "totalPaise" INTEGER NOT NULL,
    "fileId" TEXT NOT NULL,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditNoteLine" (
    "creditNoteId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "invoicePosition" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "form" "QuoteForm" NOT NULL,
    "lumpSumPaise" INTEGER,
    "embassyFeePaise" INTEGER,
    "vfsFeePaise" INTEGER,
    "otherFeePaise" INTEGER,
    "totalPaise" INTEGER NOT NULL,

    CONSTRAINT "CreditNoteLine_pkey" PRIMARY KEY ("creditNoteId","position")
);

-- CreateTable
CREATE TABLE "CreditNoteCounter" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "lastValue" INTEGER NOT NULL,

    CONSTRAINT "CreditNoteCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_creditNoteNo_key" ON "CreditNote"("creditNoteNo");

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_fileId_key" ON "CreditNote"("fileId");

-- CreateIndex
CREATE INDEX "CreditNote_invoiceId_idx" ON "CreditNote"("invoiceId");

-- CreateIndex
CREATE INDEX "CreditNote_enquiryId_idx" ON "CreditNote"("enquiryId");

-- CreateIndex
CREATE INDEX "CreditNote_issuedById_idx" ON "CreditNote"("issuedById");

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "CreditNoteReason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "CaseFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNoteLine" ADD CONSTRAINT "CreditNoteLine_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "CreditNote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A credit note is never edited (golden rule 3), like the invoice: any UPDATE or DELETE is refused. TRUNCATE (test setup
-- only) still works.
CREATE TRIGGER "CreditNote_never_edited"
  BEFORE UPDATE OR DELETE ON "CreditNote"
  FOR EACH ROW EXECUTE FUNCTION invoice_block_change();

CREATE TRIGGER "CreditNoteLine_never_edited"
  BEFORE UPDATE OR DELETE ON "CreditNoteLine"
  FOR EACH ROW EXECUTE FUNCTION invoice_block_change();

-- The totals add up, nothing is negative, and a PART credit note carries no GST (0011 Decision 5).
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_amounts_nonnegative" CHECK (
  "grossPaise" >= 0 AND "serviceChargePaise" >= 0 AND "cgstPaise" >= 0 AND "sgstPaise" >= 0 AND "igstPaise" >= 0
);
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_total_adds_up" CHECK (
  "totalPaise" = "grossPaise" + "serviceChargePaise" + "cgstPaise" + "sgstPaise" + "igstPaise"
);
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_part_has_no_gst" CHECK (
  "kind" = 'WHOLE' OR ("cgstPaise" = 0 AND "sgstPaise" = 0 AND "igstPaise" = 0)
);

-- An invoice is cancelled at most once.
CREATE UNIQUE INDEX "CreditNote_one_whole_per_invoice" ON "CreditNote"("invoiceId") WHERE "kind" = 'WHOLE';

-- A credit note is on its invoice's own case, and a WHOLE one gives back exactly what the invoice charged.
CREATE OR REPLACE FUNCTION credit_note_matches_invoice() RETURNS trigger AS $$
DECLARE
  inv "Invoice"%ROWTYPE;
BEGIN
  SELECT * INTO inv FROM "Invoice" WHERE "id" = NEW."invoiceId";
  IF inv."enquiryId" IS DISTINCT FROM NEW."enquiryId" THEN
    RAISE EXCEPTION 'A credit note must be on its invoice''s case';
  END IF;
  IF NEW."kind" = 'WHOLE' AND (NEW."grossPaise", NEW."serviceChargePaise", NEW."cgstPaise", NEW."sgstPaise", NEW."igstPaise", NEW."totalPaise")
       IS DISTINCT FROM (inv."grossPaise", inv."serviceChargePaise", inv."cgstPaise", inv."sgstPaise", inv."igstPaise", inv."totalPaise") THEN
    RAISE EXCEPTION 'A whole credit note must give back exactly what its invoice charged';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CreditNote_matches_invoice"
  BEFORE INSERT ON "CreditNote"
  FOR EACH ROW EXECUTE FUNCTION credit_note_matches_invoice();

-- A line's amounts match its form, as on the invoice, and add up.
ALTER TABLE "CreditNoteLine" ADD CONSTRAINT "CreditNoteLine_form_amounts" CHECK (
  ("form" = 'LUMP_SUM' AND "lumpSumPaise" IS NOT NULL AND "embassyFeePaise" IS NULL AND "vfsFeePaise" IS NULL AND "otherFeePaise" IS NULL
     AND "totalPaise" = "lumpSumPaise") OR
  ("form" = 'ITEMISED' AND "lumpSumPaise" IS NULL AND "embassyFeePaise" IS NOT NULL AND "vfsFeePaise" IS NOT NULL AND "otherFeePaise" IS NOT NULL
     AND "totalPaise" = "embassyFeePaise" + "vfsFeePaise" + "otherFeePaise")
);
ALTER TABLE "CreditNoteLine" ADD CONSTRAINT "CreditNoteLine_amounts_nonnegative" CHECK (
  COALESCE("lumpSumPaise", 0) >= 0 AND COALESCE("embassyFeePaise", 0) >= 0 AND COALESCE("vfsFeePaise", 0) >= 0 AND COALESCE("otherFeePaise", 0) >= 0
);
ALTER TABLE "CreditNoteLine" ADD CONSTRAINT "CreditNoteLine_positions_positive" CHECK ("position" >= 1 AND "invoicePosition" >= 1);

-- One counter row.
ALTER TABLE "CreditNoteCounter" ADD CONSTRAINT "CreditNoteCounter_single_row" CHECK ("id" = 1);
ALTER TABLE "CreditNoteCounter" ADD CONSTRAINT "CreditNoteCounter_lastValue_positive" CHECK ("lastValue" >= 1);
