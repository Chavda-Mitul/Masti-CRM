-- A message can wait before it goes (docs/decisions/0021-whatsapp-outbox.md Amendment 8): "Your price" waits
-- visa.priceMessage ⚠️, so an invoice raised meanwhile goes instead. Empty for a message that goes at once.

-- AlterTable
ALTER TABLE "OutboundMessage" ADD COLUMN     "sendAfter" TIMESTAMPTZ(3);
