-- 0015 phase 4b, the pickup at the door (docs/decisions/0015-field-staff-app.md Decision 4): the booklets he counts, the
-- client's one-time code (its hash only), and his selfie, a case file of a new kind.

-- AlterEnum
ALTER TYPE "CaseFileKind" ADD VALUE 'FIELD_SELFIE';

-- AlterTable
ALTER TABLE "FieldJob" ADD COLUMN     "bookletsCurrent" SMALLINT,
ADD COLUMN     "bookletsOld" SMALLINT,
ADD COLUMN     "otpConfirmedAt" TIMESTAMPTZ(3),
ADD COLUMN     "otpExpiresAt" TIMESTAMPTZ(3),
ADD COLUMN     "otpHash" TEXT,
ADD COLUMN     "otpSentAt" TIMESTAMPTZ(3),
ADD COLUMN     "otpSentTo" TEXT,
ADD COLUMN     "otpTries" SMALLINT NOT NULL DEFAULT 0,
ADD COLUMN     "selfieId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "FieldJob_selfieId_key" ON "FieldJob"("selfieId");

-- AddForeignKey
ALTER TABLE "FieldJob" ADD CONSTRAINT "FieldJob_selfieId_fkey" FOREIGN KEY ("selfieId") REFERENCES "CaseFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written (Prisma can't express these).

-- A PDF has its pages counted; a photo (the receiver's at the office, the field boy's selfie) has none. The kind is
-- compared as text: Postgres doesn't allow the new enum value itself until this migration is committed.
ALTER TABLE "CaseFile" DROP CONSTRAINT "CaseFile_size_and_pages";
ALTER TABLE "CaseFile" ADD CONSTRAINT "CaseFile_size_and_pages" CHECK (
  "sizeBytes" > 0
  AND (
    ("kind"::text IN ('RECEIVER_PHOTO', 'FIELD_SELFIE') AND "pageCount" IS NULL)
    OR ("kind"::text NOT IN ('RECEIVER_PHOTO', 'FIELD_SELFIE') AND "pageCount" IS NOT NULL AND "pageCount" > 0)
  )
);

-- A done job has the booklets he counted and his selfie, and only a done one; its client confirmed with the code. The
-- booklets are counted 0–50, as at intake.
ALTER TABLE "FieldJob" ADD CONSTRAINT "FieldJob_done" CHECK (
  ("status" = 'DONE') = ("bookletsCurrent" IS NOT NULL)
  AND ("status" = 'DONE') = ("bookletsOld" IS NOT NULL)
  AND ("status" = 'DONE') = ("selfieId" IS NOT NULL)
  AND ("status" <> 'DONE' OR "otpConfirmedAt" IS NOT NULL)
);
ALTER TABLE "FieldJob" ADD CONSTRAINT "FieldJob_booklets_range" CHECK (
  ("bookletsCurrent" IS NULL OR "bookletsCurrent" BETWEEN 0 AND 50) AND ("bookletsOld" IS NULL OR "bookletsOld" BETWEEN 0 AND 50)
);

-- The code: its hash, when and where it went, and until when it works, all together; confirmed only once sent; the
-- wrong tries never negative.
ALTER TABLE "FieldJob" ADD CONSTRAINT "FieldJob_otp" CHECK (
  ("otpHash" IS NULL) = ("otpSentAt" IS NULL)
  AND ("otpSentAt" IS NULL) = ("otpSentTo" IS NULL)
  AND ("otpSentAt" IS NULL) = ("otpExpiresAt" IS NULL)
  AND ("otpConfirmedAt" IS NULL OR "otpSentAt" IS NOT NULL)
  AND "otpTries" >= 0
);
