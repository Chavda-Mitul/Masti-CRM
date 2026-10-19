-- The Reminders card's switch per case (docs/decisions/0006-visa-documents.md amendment 19). When the next reminder
-- goes out is worked out from the intake day and the setting visa.documentReminders, so it isn't stored.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- AlterTable
ALTER TABLE "VisaCase" ADD COLUMN     "remindersOn" BOOLEAN NOT NULL DEFAULT true;
