import { randomUUID } from "node:crypto";
import { logger } from "../logger";
import type { WhatsAppProvider } from "./types";

// WHATSAPP_PROVIDER=log: each message goes into the server log instead of to the client, so a laptop can run the whole
// flow without a WhatsApp account, as Mailpit catches email (docs/decisions/0020-whatsapp-sending.md).

export const logOnlyProvider: WhatsAppProvider = {
  name: "log",
  async send(message) {
    const providerMessageId = `log-${randomUUID()}`;
    logger.info({ whatsapp: { ...message, providerMessageId } }, `WhatsApp to ${message.to} written to the log, not sent`);
    return { providerMessageId };
  },
};
