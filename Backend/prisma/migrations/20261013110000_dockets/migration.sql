-- Visa Step 4, component 1 (docs/decisions/0008-visa-docket-dispatch.md Decisions 2, 7, 10): dockets. A file-ready
-- case joins its vendor's open docket ("Several files in one") or a docket of its own ("One file per docket").
-- Dispatch's columns (courier, AWB, who and when) come with the Dispatch card.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)
-- CreateEnum
CREATE TYPE "DocketStatus" AS ENUM ('OPEN', 'DISPATCHED');

-- CreateEnum
CREATE TYPE "DocketKind" AS ENUM ('GROUP', 'OWN');

-- AlterTable
ALTER TABLE "VisaCase" ADD COLUMN     "docketId" TEXT;

-- CreateTable
CREATE TABLE "Docket" (
    "id" TEXT NOT NULL,
    "docketNo" TEXT NOT NULL,
    "vendorId" INTEGER NOT NULL,
    "kind" "DocketKind" NOT NULL,
    "status" "DocketStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Docket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocketCounter" (
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DocketCounter_pkey" PRIMARY KEY ("year")
);

-- CreateIndex
CREATE UNIQUE INDEX "Docket_docketNo_key" ON "Docket"("docketNo");

-- CreateIndex
CREATE INDEX "Docket_vendorId_status_idx" ON "Docket"("vendorId", "status");

-- CreateIndex
CREATE INDEX "Docket_createdById_idx" ON "Docket"("createdById");

-- CreateIndex
CREATE INDEX "VisaCase_docketId_idx" ON "VisaCase"("docketId");

-- AddForeignKey
ALTER TABLE "Docket" ADD CONSTRAINT "Docket_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Docket" ADD CONSTRAINT "Docket_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_docketId_fkey" FOREIGN KEY ("docketId") REFERENCES "Docket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- One shared (GROUP) open docket per vendor; single-case (OWN) dockets are not limited. Hand-written: Prisma can't
-- describe a partial index.
CREATE UNIQUE INDEX "Docket_one_open_group_per_vendor" ON "Docket" ("vendorId") WHERE "status" = 'OPEN' AND "kind" = 'GROUP';

-- "D-2026-0001": the prefix (letters), the year, at least four digits.
ALTER TABLE "Docket" ADD CONSTRAINT "Docket_docketNo_format" CHECK ("docketNo" ~ '^[A-Z]{1,8}-[0-9]{4}-[0-9]{4,}$');

ALTER TABLE "DocketCounter" ADD CONSTRAINT "DocketCounter_lastValue_nonnegative" CHECK ("lastValue" >= 0);
