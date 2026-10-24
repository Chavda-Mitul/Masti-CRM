-- The case's scans combined into the saved file at Docket & dispatch (docs/decisions/0008-visa-docket-dispatch.md
-- Amendment 1, change request 20): a FINAL_FILE the CRM made, rather than an upload, records how many scans went in.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- AlterTable
ALTER TABLE "CaseFile" ADD COLUMN     "scanCount" INTEGER;


-- Hand-written (Prisma can't express these).

-- Only a saved file is made from scans, and from at least one.
ALTER TABLE "CaseFile" ADD CONSTRAINT "CaseFile_scan_count" CHECK ("scanCount" IS NULL OR ("kind" = 'FINAL_FILE' AND "scanCount" > 0));
