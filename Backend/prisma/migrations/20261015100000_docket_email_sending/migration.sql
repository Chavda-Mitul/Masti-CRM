-- The email to the vendor (docs/decisions/0008-visa-docket-dispatch.md Decision 8) is sent with nothing held open: the
-- docket is marked as sending, the mail server is called outside any transaction, then the outcome is recorded. A send
-- that went can no longer be rolled back into "Not sent" and sent again.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- AlterTable
ALTER TABLE "Docket" ADD COLUMN     "vendorEmailSendingAt" TIMESTAMPTZ(3);

-- Only a dispatched docket's email is sent, and a sent one isn't sending.
ALTER TABLE "Docket" ADD CONSTRAINT "Docket_vendor_email_sending" CHECK (
  "vendorEmailSendingAt" IS NULL OR ("status" = 'DISPATCHED' AND "vendorEmailSentAt" IS NULL)
);
