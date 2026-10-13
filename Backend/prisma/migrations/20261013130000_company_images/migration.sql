-- 0009 component 2 (docs/decisions/0009-visa-invoice.md Decision 8): Masti's logo and signature for the invoice, stored
-- privately in the document bucket. The newest of each kind is current; older ones are kept.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- CreateEnum
CREATE TYPE "CompanyImageKind" AS ENUM ('LOGO', 'SIGNATURE');

-- CreateTable
CREATE TABLE "CompanyImage" (
    "id" TEXT NOT NULL,
    "kind" "CompanyImageKind" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanyImage_storageKey_key" ON "CompanyImage"("storageKey");

-- CreateIndex
CREATE INDEX "CompanyImage_kind_uploadedAt_idx" ON "CompanyImage"("kind", "uploadedAt");

-- CreateIndex
CREATE INDEX "CompanyImage_uploadedById_idx" ON "CompanyImage"("uploadedById");

-- AddForeignKey
ALTER TABLE "CompanyImage" ADD CONSTRAINT "CompanyImage_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Only PNG and JPEG (pdf-lib embeds those), and a sanity limit of 2 MB.

ALTER TABLE "CompanyImage" ADD CONSTRAINT "CompanyImage_type" CHECK ("contentType" IN ('image/png', 'image/jpeg'));

ALTER TABLE "CompanyImage" ADD CONSTRAINT "CompanyImage_size" CHECK ("sizeBytes" BETWEEN 1 AND 2097152);
