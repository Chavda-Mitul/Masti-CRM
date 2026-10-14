-- 0008 component 4a (docs/decisions/0008-visa-docket-dispatch.md Decision 6): the courier master. How a docket goes to
-- the vendor, picked at dispatch; "By hand" needs no slip (AWB) number.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- CreateTable
CREATE TABLE "Courier" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "awbNeeded" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Courier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Courier_code_key" ON "Courier"("code");

-- The master code format, as on every other list.
ALTER TABLE "Courier" ADD CONSTRAINT "Courier_code_format" CHECK ("code" ~ '^[A-Z0-9_]{1,40}$');
