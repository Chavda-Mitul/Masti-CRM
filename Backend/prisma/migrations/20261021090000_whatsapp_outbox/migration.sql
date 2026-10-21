-- The WhatsApp outbox (docs/decisions/0021-whatsapp-outbox.md): message wordings, and each message to a client,
-- written in the transaction of the change it reports and sent afterwards by the pg-boss job "whatsapp-send".
-- pg-boss keeps its own tables in the "pgboss" schema, which it creates itself.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED');

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "providerTemplateId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboundMessage" (
    "id" TEXT NOT NULL,
    "templateId" INTEGER NOT NULL,
    "clientId" TEXT NOT NULL,
    "enquiryId" TEXT,
    "toMobile" TEXT NOT NULL,
    "variables" JSONB NOT NULL,
    "body" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sendingAt" TIMESTAMPTZ(3),
    "provider" TEXT,
    "providerMessageId" TEXT,
    "sentTo" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMPTZ(3),
    "deliveredAt" TIMESTAMPTZ(3),
    "readAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_code_key" ON "MessageTemplate"("code");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundMessage_idempotencyKey_key" ON "OutboundMessage"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OutboundMessage_clientId_createdAt_idx" ON "OutboundMessage"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "OutboundMessage_enquiryId_createdAt_idx" ON "OutboundMessage"("enquiryId", "createdAt");

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MessageTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (Prisma can't express these).

-- A message that went says how: when, through whom, their id for it and the number it went to.
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_sent" CHECK (
  "status" NOT IN ('SENT', 'DELIVERED', 'READ')
  OR ("sentAt" IS NOT NULL AND "provider" IS NOT NULL AND "providerMessageId" IS NOT NULL AND "sentTo" IS NOT NULL)
);
-- Delivered and read carry their moment.
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_receipts" CHECK (
  ("status" <> 'DELIVERED' OR "deliveredAt" IS NOT NULL) AND ("status" <> 'READ' OR "readAt" IS NOT NULL)
);
-- A failed one says why and when.
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_failed" CHECK (
  "status" <> 'FAILED' OR ("error" IS NOT NULL AND "failedAt" IS NOT NULL)
);
-- Only a waiting message can be with the provider mid-try.
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_sending" CHECK ("sendingAt" IS NULL OR "status" = 'QUEUED');
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_attempts_nonnegative" CHECK ("attempts" >= 0);
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_body_not_blank" CHECK (btrim("body") <> '');
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_toMobile_format" CHECK ("toMobile" ~ '^\+91[6-9][0-9]{9}$');
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_name_not_blank" CHECK (btrim("name") <> '');
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_body_not_blank" CHECK (btrim("body") <> '');
