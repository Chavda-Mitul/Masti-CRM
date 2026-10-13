-- Files kept for a case in the S3-compatible bucket (docs/decisions/0007-visa-file-prep.md Decision 8): first, the visa
-- file as it went to the vendor, one PDF. Rows are never deleted; older uploads stay as proof.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- CreateEnum
CREATE TYPE "CaseFileKind" AS ENUM ('FINAL_FILE');

-- CreateTable
CREATE TABLE "CaseFile" (
    "id" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "kind" "CaseFileKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "pageCount" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CaseFile_storageKey_key" ON "CaseFile"("storageKey");

-- CreateIndex
CREATE INDEX "CaseFile_enquiryId_kind_uploadedAt_idx" ON "CaseFile"("enquiryId", "kind", "uploadedAt");

-- AddForeignKey
ALTER TABLE "CaseFile" ADD CONSTRAINT "CaseFile_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseFile" ADD CONSTRAINT "CaseFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written (Prisma can't express these).

-- A stored file always has bytes and pages.
ALTER TABLE "CaseFile" ADD CONSTRAINT "CaseFile_size_and_pages" CHECK ("sizeBytes" > 0 AND "pageCount" > 0);
