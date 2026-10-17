-- Visa Step 8, the office handover (docs/decisions/0014-visa-delivered.md, component 1): the passports handed back to
-- the client, once per case, with the booklets counted, who collected them and a photo of that person (a new kind of
-- case file, which has no page count). A delivered case that closes has no due time.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- CreateEnum
CREATE TYPE "HandoverMode" AS ENUM ('OFFICE', 'DELIVERY');

-- AlterEnum
ALTER TYPE "CaseFileKind" ADD VALUE 'RECEIVER_PHOTO';

-- AlterTable
ALTER TABLE "CaseFile" ALTER COLUMN "pageCount" DROP NOT NULL;

-- CreateTable
CREATE TABLE "VisaHandover" (
    "enquiryId" TEXT NOT NULL,
    "mode" "HandoverMode" NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "byId" TEXT NOT NULL,
    "bookletsCurrent" SMALLINT NOT NULL,
    "bookletsOld" SMALLINT NOT NULL,
    "receiverTravellerId" TEXT,
    "receiverName" TEXT,
    "receiverPhotoId" TEXT,

    CONSTRAINT "VisaHandover_pkey" PRIMARY KEY ("enquiryId")
);

-- CreateIndex
CREATE UNIQUE INDEX "VisaHandover_receiverPhotoId_key" ON "VisaHandover"("receiverPhotoId");

-- CreateIndex
CREATE INDEX "VisaHandover_byId_idx" ON "VisaHandover"("byId");

-- CreateIndex
CREATE INDEX "VisaHandover_receiverTravellerId_idx" ON "VisaHandover"("receiverTravellerId");

-- AddForeignKey
ALTER TABLE "VisaHandover" ADD CONSTRAINT "VisaHandover_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "VisaCase"("enquiryId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisaHandover" ADD CONSTRAINT "VisaHandover_byId_fkey" FOREIGN KEY ("byId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisaHandover" ADD CONSTRAINT "VisaHandover_receiverTravellerId_fkey" FOREIGN KEY ("receiverTravellerId") REFERENCES "VisaCaseTraveller"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisaHandover" ADD CONSTRAINT "VisaHandover_receiverPhotoId_fkey" FOREIGN KEY ("receiverPhotoId") REFERENCES "CaseFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written (Prisma can't express these).

-- A PDF has its pages counted; a photo has none. The kind is compared as text: Postgres doesn't allow the new enum value
-- itself until this migration is committed.
ALTER TABLE "CaseFile" DROP CONSTRAINT "CaseFile_size_and_pages";
ALTER TABLE "CaseFile" ADD CONSTRAINT "CaseFile_size_and_pages" CHECK (
  "sizeBytes" > 0
  AND (
    ("kind"::text = 'RECEIVER_PHOTO' AND "pageCount" IS NULL)
    OR ("kind"::text <> 'RECEIVER_PHOTO' AND "pageCount" IS NOT NULL AND "pageCount" > 0)
  )
);

-- Who collected the passports: a traveller on the case, or someone else by name, never both (Decision 3). The name's
-- letters are checked by the server, as for clients.
ALTER TABLE "VisaHandover" ADD CONSTRAINT "VisaHandover_one_receiver" CHECK (("receiverTravellerId" IS NULL) <> ("receiverName" IS NULL));
ALTER TABLE "VisaHandover" ADD CONSTRAINT "VisaHandover_receiver_name" CHECK (
  "receiverName" IS NULL OR (btrim("receiverName") <> '' AND char_length("receiverName") BETWEEN 2 AND 100)
);

-- Each count 0–50, at least one booklet. (That they equal the stock count is the service's, Decision 4.)
ALTER TABLE "VisaHandover" ADD CONSTRAINT "VisaHandover_booklets_range" CHECK (
  "bookletsCurrent" BETWEEN 0 AND 50 AND "bookletsOld" BETWEEN 0 AND 50 AND "bookletsCurrent" + "bookletsOld" >= 1
);

-- At the office, the person collecting is photographed (Decision 3).
ALTER TABLE "VisaHandover" ADD CONSTRAINT "VisaHandover_office_photo" CHECK ("mode" <> 'OFFICE' OR "receiverPhotoId" IS NOT NULL);

-- A closed enquiry is due nowhere and resumes never.
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_closed_not_due" CHECK ("status" <> 'CLOSED' OR ("dueAt" IS NULL AND "resumeOn" IS NULL));
