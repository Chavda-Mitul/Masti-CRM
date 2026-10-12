-- The processor's check of each paper in Step 3 (docs/decisions/0007-visa-file-prep.md Decision 3): Checked, or Needs
-- replacing with a reason from the DocumentProblemReason master.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- CreateEnum
CREATE TYPE "DocumentCheck" AS ENUM ('CHECKED', 'NEEDS_REPLACING');

-- AlterTable
ALTER TABLE "VisaCaseDocument" ADD COLUMN     "check" "DocumentCheck",
ADD COLUMN     "checkReasonId" INTEGER,
ADD COLUMN     "checkedAt" TIMESTAMPTZ(3),
ADD COLUMN     "checkedById" TEXT;

-- CreateTable
CREATE TABLE "DocumentProblemReason" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DocumentProblemReason_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DocumentProblemReason_code_key" ON "DocumentProblemReason"("code");

-- AddForeignKey
ALTER TABLE "VisaCaseDocument" ADD CONSTRAINT "VisaCaseDocument_checkReasonId_fkey" FOREIGN KEY ("checkReasonId") REFERENCES "DocumentProblemReason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisaCaseDocument" ADD CONSTRAINT "VisaCaseDocument_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written (Prisma can't express these).

-- Master codes never change and follow one format, as EnquirySource.
ALTER TABLE "DocumentProblemReason" ADD CONSTRAINT "DocumentProblemReason_code_format" CHECK ("code" ~ '^[A-Z0-9_]{1,40}$');

-- A reason exactly when the paper needs replacing: Checked clears it.
ALTER TABLE "VisaCaseDocument" ADD CONSTRAINT "VisaCaseDocument_check_reason"
  CHECK (("check" IS NOT DISTINCT FROM 'NEEDS_REPLACING') = ("checkReasonId" IS NOT NULL));

-- A check always says who and when.
ALTER TABLE "VisaCaseDocument" ADD CONSTRAINT "VisaCaseDocument_check_stamped"
  CHECK (("check" IS NULL) = ("checkedAt" IS NULL) AND ("check" IS NULL) = ("checkedById" IS NULL));

-- Only a paper that came in, or that we made, is checked.
ALTER TABLE "VisaCaseDocument" ADD CONSTRAINT "VisaCaseDocument_check_needs_paper"
  CHECK ("check" IS NULL OR "status" IN ('RECEIVED', 'MADE'));
