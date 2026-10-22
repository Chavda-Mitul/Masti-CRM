-- E-visas after the decision, part 2 (docs/decisions/0025-evisa-after-decision.md): a WhatsApp message can carry one of
-- the case's files. The provider fetches it through the CRM's own short-lived link; only the SHA-256 of the link's key
-- is kept, with when the link stops working.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- AlterTable
ALTER TABLE "OutboundMessage" ADD COLUMN     "attachmentId" TEXT,
ADD COLUMN     "attachmentKeyExpiresAt" TIMESTAMPTZ(3),
ADD COLUMN     "attachmentKeyHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "OutboundMessage_attachmentKeyHash_key" ON "OutboundMessage"("attachmentKeyHash");

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "CaseFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written (Prisma can't express these).

-- A file link's key and its expiry go together, and only a message with a file has one.
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_attachment_key" CHECK (("attachmentKeyHash" IS NULL) = ("attachmentKeyExpiresAt" IS NULL));
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_attachment_key_file" CHECK ("attachmentKeyHash" IS NULL OR "attachmentId" IS NOT NULL);
