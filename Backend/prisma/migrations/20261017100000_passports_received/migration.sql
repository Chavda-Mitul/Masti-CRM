-- Visa Step 7, "Mark received" (docs/decisions/0013-visa-passport-back.md Decision 5): the packet was opened at our
-- office and the passports are in our stock, by whom and when, with the booklets counted; each approved traveller's
-- sticker checked against the passport's name and dates. Never changed once saved (decided 17 Oct 2026).
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- CreateEnum
CREATE TYPE "StickerCheck" AS ENUM ('MATCHES', 'MISMATCH');

-- AlterTable
ALTER TABLE "VisaCase" ADD COLUMN     "bookletsBackCurrent" SMALLINT,
ADD COLUMN     "bookletsBackOld" SMALLINT,
ADD COLUMN     "passportsReceivedAt" TIMESTAMPTZ(3),
ADD COLUMN     "passportsReceivedById" TEXT;

-- AlterTable
ALTER TABLE "VisaCaseTraveller" ADD COLUMN     "stickerCheck" "StickerCheck";

-- AddForeignKey
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_passportsReceivedById_fkey" FOREIGN KEY ("passportsReceivedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written (Prisma can't express these).

-- Who, when and the two counts go together.
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_received_together" CHECK (
  ("passportsReceivedAt" IS NULL) = ("passportsReceivedById" IS NULL)
  AND ("passportsReceivedAt" IS NULL) = ("bookletsBackCurrent" IS NULL)
  AND ("passportsReceivedAt" IS NULL) = ("bookletsBackOld" IS NULL)
);

-- Received only once they were on their way back, and not before that was recorded.
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_received_after_transit" CHECK (
  "passportsReceivedAt" IS NULL OR ("passportsInTransitAt" IS NOT NULL AND "passportsReceivedAt" >= "passportsInTransitAt")
);

-- Each count 0–50, as at intake, and at least one booklet in the packet.
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_booklets_back_range" CHECK (
  "bookletsBackCurrent" BETWEEN 0 AND 50 AND "bookletsBackOld" BETWEEN 0 AND 50 AND "bookletsBackCurrent" + "bookletsBackOld" >= 1
);

-- Only an approved traveller has a sticker to check.
ALTER TABLE "VisaCaseTraveller" ADD CONSTRAINT "VisaCaseTraveller_sticker_check_approved" CHECK (
  "stickerCheck" IS NULL OR "outcome" = 'APPROVED'
);
