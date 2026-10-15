-- 0011 component 5a (docs/decisions/0011-visa-at-vendor.md Decision 7): the extra-charges master. What an additional
-- invoice charges for is picked from it, never typed; the amount is typed when it's raised.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- CreateTable
CREATE TABLE "ExtraCharge" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ExtraCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExtraCharge_code_key" ON "ExtraCharge"("code");

-- The master code format, as on every other list.
ALTER TABLE "ExtraCharge" ADD CONSTRAINT "ExtraCharge_code_format" CHECK ("code" ~ '^[A-Z0-9_]{1,40}$');
