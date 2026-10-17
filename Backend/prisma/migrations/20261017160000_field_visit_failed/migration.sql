-- 0015 phase 4a, a visit that fails (docs/decisions/0015-field-staff-app.md Decision 5): the list of reasons, and on
-- each job when it finished, the place his phone gave, and for a failed visit, why.

-- AlterTable
ALTER TABLE "FieldJob" ADD COLUMN     "accuracyM" INTEGER,
ADD COLUMN     "failReasonId" INTEGER,
ADD COLUMN     "finishedAt" TIMESTAMPTZ(3),
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "FieldFailReason" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "FieldFailReason_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FieldFailReason_code_key" ON "FieldFailReason"("code");

-- AddForeignKey
ALTER TABLE "FieldJob" ADD CONSTRAINT "FieldJob_failReasonId_fkey" FOREIGN KEY ("failReasonId") REFERENCES "FieldFailReason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written (Prisma can't express these).

-- A reason's code follows the other lists' format; its name isn't blank.
ALTER TABLE "FieldFailReason" ADD CONSTRAINT "FieldFailReason_code_format" CHECK ("code" ~ '^[A-Z0-9_]{1,40}$');
ALTER TABLE "FieldFailReason" ADD CONSTRAINT "FieldFailReason_name_not_blank" CHECK (btrim("name") <> '');

-- A finished job (done, or couldn't complete) has when and where, and only a finished one has them (golden rule 5: the
-- place for field actions). The place is in range; its accuracy is whole metres, never negative. A failed visit has its
-- reason, and only a failed one.
ALTER TABLE "FieldJob" ADD CONSTRAINT "FieldJob_finished" CHECK (
  ("status" IN ('DONE', 'FAILED')) = ("finishedAt" IS NOT NULL)
  AND ("finishedAt" IS NULL) = ("latitude" IS NULL)
  AND ("finishedAt" IS NULL) = ("longitude" IS NULL)
  AND ("finishedAt" IS NULL) = ("accuracyM" IS NULL)
);
ALTER TABLE "FieldJob" ADD CONSTRAINT "FieldJob_place" CHECK (
  ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90)
  AND ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180)
  AND ("accuracyM" IS NULL OR "accuracyM" >= 0)
);
ALTER TABLE "FieldJob" ADD CONSTRAINT "FieldJob_failed" CHECK (("status" = 'FAILED') = ("failReasonId" IS NOT NULL));
