-- 0008 component 4b (docs/decisions/0008-visa-docket-dispatch.md Decision 9): dispatching a docket. Who sent it and
-- when, the courier, and the courier's slip (AWB) number.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- AlterTable
ALTER TABLE "Docket" ADD COLUMN     "awbNo" TEXT,
ADD COLUMN     "courierId" INTEGER,
ADD COLUMN     "dispatchedAt" TIMESTAMPTZ(3),
ADD COLUMN     "dispatchedById" TEXT;

-- CreateIndex
CREATE INDEX "Docket_courierId_idx" ON "Docket"("courierId");

-- CreateIndex
CREATE INDEX "Docket_dispatchedById_idx" ON "Docket"("dispatchedById");

-- AddForeignKey
ALTER TABLE "Docket" ADD CONSTRAINT "Docket_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Docket" ADD CONSTRAINT "Docket_dispatchedById_fkey" FOREIGN KEY ("dispatchedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A dispatched docket has who, when and the courier; an open one has none of them, and no slip number.
ALTER TABLE "Docket" ADD CONSTRAINT "Docket_dispatch_fields" CHECK (
  ("status" = 'DISPATCHED' AND "dispatchedAt" IS NOT NULL AND "dispatchedById" IS NOT NULL AND "courierId" IS NOT NULL)
  OR ("status" = 'OPEN' AND "dispatchedAt" IS NULL AND "dispatchedById" IS NULL AND "courierId" IS NULL AND "awbNo" IS NULL)
);

-- The slip number is capitals and digits. Its length rule is the setting visa.awb; 40 is only a sanity limit.
ALTER TABLE "Docket" ADD CONSTRAINT "Docket_awbNo_format" CHECK ("awbNo" ~ '^[A-Z0-9]{1,40}$');
