import { randomUUID } from "node:crypto";
import { isProduction } from "../../config/env";
import { logger } from "../logger";
import { hideSecrets } from "./secrets";
import type { WhatsAppMessage, WhatsAppProvider } from "./types";

// WHATSAPP_PROVIDER=log: each message goes into the server log instead of to the client, so a laptop can run the whole
// flow without a WhatsApp account, as Mailpit catches email (docs/decisions/0020-whatsapp-sending.md).

/** A link's part after "#" is its secret (the consent link, docs/decisions/0022-consent-form.md): "…/consent#…". */
const hideLinkSecrets = (text: string) => text.replace(/(https?:\/\/[^\s#]+)#[A-Za-z0-9_-]+/g, "$1#…");

/** A file link's key (docs/decisions/0025-evisa-after-decision.md, part 2): "…/message-files/…?key=…". */
const hideFileKey = (url: string) => url.replace(/([?&]key=)[^&#]+/g, "$1…");

/**
 * What the log keeps of a message. When live, no link's secret, no door code and no file link's key: reading the
 * server log mustn't let anyone act for a client, or open their file. On a laptop the log is the only place to open
 * the link or read the code, so they stay whole there.
 */
export function forTheLog(message: WhatsAppMessage, live = isProduction): WhatsAppMessage {
  const { secrets = [], ...words } = message;
  if (!live) return words;
  const hide = (text: string) => hideLinkSecrets(hideSecrets(text, secrets));
  const { template, attachment } = words;
  return {
    ...words,
    body: hide(words.body),
    ...(template ? { template: { ...template, variables: Object.fromEntries(Object.entries(template.variables).map(([name, value]) => [name, hide(value)])) } } : {}),
    ...(attachment ? { attachment: { ...attachment, url: hideFileKey(attachment.url) } } : {}),
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
