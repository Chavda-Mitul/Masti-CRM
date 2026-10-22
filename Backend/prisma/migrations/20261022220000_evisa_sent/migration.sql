-- E-visas after the decision, part 3 (docs/decisions/0025-evisa-after-decision.md): "Send the e-visa", by whom and when.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- AlterTable
ALTER TABLE "VisaCase" ADD COLUMN     "evisaSentAt" TIMESTAMPTZ(3),
ADD COLUMN     "evisaSentById" TEXT;

-- AddForeignKey
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_evisaSentById_fkey" FOREIGN KEY ("evisaSentById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written (Prisma can't express these).

-- Who and when are set together, and only an e-visa (one that went in online) is sent this way.
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_evisa_sent" CHECK (("evisaSentAt" IS NULL) = ("evisaSentById" IS NULL));
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_evisa_sent_online" CHECK ("evisaSentAt" IS NULL OR "submittedOnlineAt" IS NOT NULL);
