-- Scheduled password changes (docs/decisions/0024-portal-logins.md, component 2): each portal's password has to change
-- daily, weekly or monthly, or has no schedule. From the start of the due date the portal is locked for everyone until an
-- HOD types a new password; the due date and the lock are worked out from "passwordChangedAt", so nothing else is kept.
-- The default is monthly, as Masti changes them.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- CreateEnum
CREATE TYPE "PortalPasswordSchedule" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'NONE');

-- AlterTable
ALTER TABLE "PortalLogin" ADD COLUMN     "passwordSchedule" "PortalPasswordSchedule" NOT NULL DEFAULT 'MONTHLY';
