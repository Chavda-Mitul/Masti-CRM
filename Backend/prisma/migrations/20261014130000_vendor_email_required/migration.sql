-- Every vendor has an email (decided 14 Oct 2026, project lead): the dispatch email goes to it
-- (docs/decisions/0008-visa-docket-dispatch.md Decision 8). Still in development, so there is no backfill: a database
-- holding a vendor without one is reset (`npx prisma migrate reset`, then `npm run db:seed`).
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- AlterTable
ALTER TABLE "Vendor" ALTER COLUMN "email" SET NOT NULL;

-- Stored as the service cleans it: not empty, lowercased.
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_email_clean" CHECK ("email" <> '' AND "email" = lower("email"));
