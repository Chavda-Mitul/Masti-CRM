-- The client document vault in visa Step 2 (docs/decisions/0016-client-documents.md Decision 5): a paper that may be a
-- xerox can be ticked On file, printed from the copy in the client's vault; the paper keeps which scan it came from.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- AlterEnum
ALTER TYPE "ReceivedAs" ADD VALUE 'ON_FILE';

-- AlterTable
ALTER TABLE "VisaCaseDocument" ADD COLUMN     "clientDocumentId" TEXT;

-- CreateIndex
CREATE INDEX "VisaCaseDocument_clientDocumentId_idx" ON "VisaCaseDocument"("clientDocumentId");

-- AddForeignKey
ALTER TABLE "VisaCaseDocument" ADD CONSTRAINT "VisaCaseDocument_clientDocumentId_fkey" FOREIGN KEY ("clientDocumentId") REFERENCES "ClientDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written (Prisma can't express these). receivedAs is compared as text: Postgres doesn't allow the new enum value
-- itself until this migration is committed.

-- An On file paper names the scan it came from, and only an On file paper does.
ALTER TABLE "VisaCaseDocument" ADD CONSTRAINT "VisaCaseDocument_on_file" CHECK (("receivedAs"::text IS NOT DISTINCT FROM 'ON_FILE') = ("clientDocumentId" IS NOT NULL));

-- A copy never stands in for a paper the checklist needs as an original, or for a thing we arrange.
ALTER TABLE "VisaCaseDocument" ADD CONSTRAINT "VisaCaseDocument_on_file_xerox" CHECK ("receivedAs"::text IS DISTINCT FROM 'ON_FILE' OR "requirement" = 'XEROX_OK');
