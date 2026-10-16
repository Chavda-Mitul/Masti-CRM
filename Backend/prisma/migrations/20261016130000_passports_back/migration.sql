-- Visa Step 7, passports on the way back (docs/decisions/0013-visa-passport-back.md Decision 3): the day the vendor
-- collected the passports, the day they're expected at our office, and who recorded it when. They're in transit from
-- then until they're marked received.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- AlterTable
ALTER TABLE "VisaCase" ADD COLUMN     "passportsCollectedOn" DATE,
ADD COLUMN     "passportsExpectedOn" DATE,
ADD COLUMN     "passportsInTransitAt" TIMESTAMPTZ(3),
ADD COLUMN     "passportsInTransitById" TEXT;

-- AddForeignKey
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_passportsInTransitById_fkey" FOREIGN KEY ("passportsInTransitById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written (Prisma can't express these).

-- The two days, who and when go together.
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_in_transit_together" CHECK (
  ("passportsInTransitAt" IS NULL) = ("passportsCollectedOn" IS NULL)
  AND ("passportsInTransitAt" IS NULL) = ("passportsExpectedOn" IS NULL)
  AND ("passportsInTransitAt" IS NULL) = ("passportsInTransitById" IS NULL)
);

-- Expected on or after the day the vendor collected them, and collected no later than the day it was recorded (IST).
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_in_transit_dates" CHECK (
  "passportsExpectedOn" >= "passportsCollectedOn"
  AND "passportsCollectedOn" <= ("passportsInTransitAt" AT TIME ZONE 'Asia/Kolkata')::date
);

-- Only once the decision is recorded or the file was recalled; never for an e-visa, whose passports never left
-- (Decision 4).
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_in_transit_after_decision" CHECK (
  "passportsInTransitAt" IS NULL OR "decidedAt" IS NOT NULL OR "recalledAt" IS NOT NULL
);
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_in_transit_not_online" CHECK ("passportsInTransitAt" IS NULL OR "submittedOnlineAt" IS NULL);
