
-- CreateTable
CREATE TABLE "InboundMessage" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "fromMobile" TEXT NOT NULL,
    "clientId" TEXT,
    "enquiryId" TEXT,
    "type" TEXT NOT NULL,
    "text" TEXT,
    "replyToProviderMessageId" TEXT,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InboundMessage_enquiryId_receivedAt_idx" ON "InboundMessage"("enquiryId", "receivedAt");

-- CreateIndex
CREATE INDEX "InboundMessage_clientId_receivedAt_idx" ON "InboundMessage"("clientId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InboundMessage_provider_providerMessageId_key" ON "InboundMessage"("provider", "providerMessageId");

-- CreateIndex
CREATE INDEX "OutboundMessage_sentTo_sentAt_idx" ON "OutboundMessage"("sentTo", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboundMessage_provider_providerMessageId_key" ON "OutboundMessage"("provider", "providerMessageId");

-- AddForeignKey
ALTER TABLE "InboundMessage" ADD CONSTRAINT "InboundMessage_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InboundMessage" ADD CONSTRAINT "InboundMessage_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written (Prisma can't express these).

-- A client's message says who brought it and who wrote, in the shape the CRM keeps numbers.
ALTER TABLE "InboundMessage" ADD CONSTRAINT "InboundMessage_provider_not_blank" CHECK (btrim("provider") <> '' AND btrim("providerMessageId") <> '');
ALTER TABLE "InboundMessage" ADD CONSTRAINT "InboundMessage_fromMobile_format" CHECK ("fromMobile" ~ '^\+[1-9][0-9]{6,14}$');
ALTER TABLE "InboundMessage" ADD CONSTRAINT "InboundMessage_type_not_blank" CHECK (btrim("type") <> '');
-- Words, when there are any, aren't blank: a photo without words has none.
ALTER TABLE "InboundMessage" ADD CONSTRAINT "InboundMessage_text_not_blank" CHECK ("text" IS NULL OR btrim("text") <> '');
-- A message tied to a case is tied to its client too.
ALTER TABLE "InboundMessage" ADD CONSTRAINT "InboundMessage_case_has_client" CHECK ("enquiryId" IS NULL OR "clientId" IS NOT NULL);
