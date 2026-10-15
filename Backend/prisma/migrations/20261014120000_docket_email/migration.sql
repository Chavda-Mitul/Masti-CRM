-- 0008 component 4c (docs/decisions/0008-visa-docket-dispatch.md Decision 8): the email to the vendor, sent once the
-- docket is dispatched. When and to whom it went, or why it failed, for "Send again".
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- AlterTable
ALTER TABLE "Docket" ADD COLUMN     "vendorEmailError" TEXT,
ADD COLUMN     "vendorEmailSentAt" TIMESTAMPTZ(3),
ADD COLUMN     "vendorEmailTo" TEXT;

-- Sent means when and to whom, together, and no error; only a dispatched docket has any of it.
ALTER TABLE "Docket" ADD CONSTRAINT "Docket_vendor_email" CHECK (
  ("vendorEmailSentAt" IS NULL) = ("vendorEmailTo" IS NULL)
  AND NOT ("vendorEmailSentAt" IS NOT NULL AND "vendorEmailError" IS NOT NULL)
  AND ("status" = 'DISPATCHED' OR ("vendorEmailSentAt" IS NULL AND "vendorEmailError" IS NULL))
);
