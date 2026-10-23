-- No LOST status: a cancelled case is lost business, with its cancel reason (docs/decisions/0017-today-dashboard.md
-- amendment 2). Nothing ever set LOST, so no row changes. Hand-edited: the three CHECKs that name a status are dropped
-- before the type swap and added back after it, since they were written against the old type.

-- AlterEnum
BEGIN;
ALTER TABLE "Enquiry" DROP CONSTRAINT "Enquiry_postponed_has_reason_and_date";
ALTER TABLE "Enquiry" DROP CONSTRAINT "Enquiry_cancelled_has_reason";
ALTER TABLE "Enquiry" DROP CONSTRAINT "Enquiry_closed_not_due";
CREATE TYPE "EnquiryStatus_new" AS ENUM ('OPEN', 'POSTPONED', 'CANCELLED', 'CLOSED');
ALTER TABLE "public"."Enquiry" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Enquiry" ALTER COLUMN "status" TYPE "EnquiryStatus_new" USING ("status"::text::"EnquiryStatus_new");
ALTER TYPE "EnquiryStatus" RENAME TO "EnquiryStatus_old";
ALTER TYPE "EnquiryStatus_new" RENAME TO "EnquiryStatus";
DROP TYPE "public"."EnquiryStatus_old";
ALTER TABLE "Enquiry" ALTER COLUMN "status" SET DEFAULT 'OPEN';
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_postponed_has_reason_and_date"
  CHECK ("status" <> 'POSTPONED' OR ("reasonId" IS NOT NULL AND "resumeOn" IS NOT NULL));
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_cancelled_has_reason"
  CHECK ("status" <> 'CANCELLED' OR "reasonId" IS NOT NULL);
ALTER TABLE "Enquiry" ADD CONSTRAINT "Enquiry_closed_not_due" CHECK ("status" <> 'CLOSED' OR ("dueAt" IS NULL AND "resumeOn" IS NULL));
COMMIT;
