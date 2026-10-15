-- E-visas, "Submitted online" (docs/decisions/0008-visa-docket-dispatch.md Decision 11): a visa whose Vendor needed is
-- off goes in on the portal, with no docket, sticker or courier. Who pressed it and when are kept on the case.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- AlterTable
ALTER TABLE "VisaCase" ADD COLUMN     "submittedOnlineAt" TIMESTAMPTZ(3),
ADD COLUMN     "submittedOnlineById" TEXT;

-- AddForeignKey
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_submittedOnlineById_fkey" FOREIGN KEY ("submittedOnlineById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Who and when are set together; a case goes either in a docket or online, never both; and only a file-ready case
-- can be submitted.
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_submitted_online_pair" CHECK (("submittedOnlineAt" IS NULL) = ("submittedOnlineById" IS NULL));
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_online_or_docket" CHECK ("submittedOnlineAt" IS NULL OR "docketId" IS NULL);
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_online_after_file_ready" CHECK ("submittedOnlineAt" IS NULL OR "fileReadyAt" IS NOT NULL);
