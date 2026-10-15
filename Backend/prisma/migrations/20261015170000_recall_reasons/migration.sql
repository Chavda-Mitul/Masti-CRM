-- 0011 component 4a (docs/decisions/0011-visa-at-vendor.md Decision 6): the recall-reasons master. Why a file is taken
-- back from the vendor is picked from it, never typed, so reports can count why files come back.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- CreateTable
CREATE TABLE "RecallReason" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "RecallReason_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecallReason_code_key" ON "RecallReason"("code");

-- The master code format, as on every other list.
ALTER TABLE "RecallReason" ADD CONSTRAINT "RecallReason_code_format" CHECK ("code" ~ '^[A-Z0-9_]{1,40}$');
