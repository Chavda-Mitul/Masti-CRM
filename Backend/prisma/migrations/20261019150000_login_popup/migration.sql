-- The visa team's login popup (docs/decisions/0017-today-dashboard.md Decision 12): the Head or the Visa HOD puts a Visa
-- notice in it (loginPopupAt: when), and each person's popup shows only what arrived after they last dismissed it
-- (loginPopupSeenAt).
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- AlterTable
ALTER TABLE "Notice" ADD COLUMN     "loginPopupAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "loginPopupSeenAt" TIMESTAMPTZ(3);
