-- Visa Step 8: the client's one-time code at the office handover too (docs/decisions/0014-visa-delivered.md Decision 2,
-- amended 23 Oct 2026). Every handover keeps the code's proof: the number it went to and when the client confirmed it
-- (at the door, copied from the boy's job). The desk's code waits in its own table, one per case, until the handover.
-- No backfill: earlier handovers had no code, so the dev database is reset and seeded again (still in development).
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- AlterTable
ALTER TABLE "VisaHandover" ADD COLUMN     "codeConfirmedAt" TIMESTAMPTZ(3) NOT NULL,
ADD COLUMN     "codeSentTo" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "HandoverCode" (
    "enquiryId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "sentAt" TIMESTAMPTZ(3) NOT NULL,
    "sentTo" TEXT NOT NULL,
    "sentById" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "tries" SMALLINT NOT NULL DEFAULT 0,
    "confirmedAt" TIMESTAMPTZ(3),

    CONSTRAINT "HandoverCode_pkey" PRIMARY KEY ("enquiryId")
);

-- CreateIndex
CREATE INDEX "HandoverCode_sentById_idx" ON "HandoverCode"("sentById");

-- AddForeignKey
ALTER TABLE "HandoverCode" ADD CONSTRAINT "HandoverCode_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "VisaCase"("enquiryId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoverCode" ADD CONSTRAINT "HandoverCode_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written (Prisma can't express these).

-- A code works for a while after it went, counts its wrong tries from none, and is confirmed only after it went.
ALTER TABLE "HandoverCode" ADD CONSTRAINT "HandoverCode_times" CHECK (
  "expiresAt" > "sentAt"
  AND "tries" >= 0
  AND ("confirmedAt" IS NULL OR "confirmedAt" >= "sentAt")
);

-- The client confirmed the code, sent to a number, before the passports were handed over.
ALTER TABLE "VisaHandover" ADD CONSTRAINT "VisaHandover_code" CHECK (
  "codeConfirmedAt" <= "at"
  AND length(btrim("codeSentTo")) > 0
);
