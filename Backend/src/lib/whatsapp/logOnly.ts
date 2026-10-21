import { randomUUID } from "node:crypto";
import { isProduction } from "../../config/env";
import { logger } from "../logger";
import type { WhatsAppMessage, WhatsAppProvider } from "./types";

// WHATSAPP_PROVIDER=log: each message goes into the server log instead of to the client, so a laptop can run the whole
// flow without a WhatsApp account, as Mailpit catches email (docs/decisions/0020-whatsapp-sending.md).

/** A link's part after "#" is its secret (the consent link, docs/decisions/0022-consent-form.md): "…/consent#…". */
const hideLinkSecrets = (text: string) => text.replace(/(https?:\/\/[^\s#]+)#[A-Za-z0-9_-]+/g, "$1#…");

/**
 * What the log keeps of a message. When live, no link's secret: reading the server log mustn't let anyone act for a
 * client. On a laptop the log is the only place to open the link, so it stays whole there.
 */
export function forTheLog(message: WhatsAppMessage, live = isProduction): WhatsAppMessage {
  if (!live) return message;
  const { template } = message;
  return {
    ...message,
    body: hideLinkSecrets(message.body),
    ...(template
      ? { template: { ...template, variables: Object.fromEntries(Object.entries(template.variables).map(([name, value]) => [name, hideLinkSecrets(value)])) } }
      : {}),
  };
}

export const logOnlyProvider: WhatsAppProvider = {
  name: "log",
  async send(message) {
    const providerMessageId = `log-${randomUUID()}`;
    logger.info({ whatsapp: { ...forTheLog(message), providerMessageId } }, `WhatsApp to ${message.to} written to the log, not sent`);
    return { providerMessageId };
  },
};
