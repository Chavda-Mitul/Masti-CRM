import type { CaseFile, Client, InboundMessage, MessageTemplate, OutboundMessage } from "../../../generated/prisma/client";
import { env, isProduction } from "../../config/env";
import { hideSecrets, secretValues } from "../../lib/whatsapp/secrets";
import { maskConsentLinks } from "../consent/consentToken";

// A message to a client as the browser sees it (docs/decisions/0021-whatsapp-outbox.md, the "Sent to the client"
// card): what it said, the file it carried, where it has got to, and why it failed. The sending details (the provider's
// id, the tries, the send mark, the values, the file link's key) stay on the server.

export function toMessageDto(row: OutboundMessage & { template: Pick<MessageTemplate, "name">; attachment: Pick<CaseFile, "fileName"> | null }) {
  return {
    id: row.id,
    title: row.template.name,
    // A consent link's secret and the door code are the client's alone: staff see the message without them, even while
    // it waits to go (0022; 0021 amendment 6).
    body: maskConsentLinks(hideSecrets(row.body, secretValues(row.variables as Record<string, string>))),
    /** The case's file it carried (0025, part 2): an e-visa's PDF. */
    attachment: row.attachment && { fileName: row.attachment.fileName },
    status: row.status,
    error: row.error,
    createdAt: row.createdAt,
    sentAt: row.sentAt,
    deliveredAt: row.deliveredAt,
    readAt: row.readAt,
    failedAt: row.failedAt,
    /** Outside production it went to WHATSAPP_TEST_NUMBER instead of the client. */
    toTestNumber: row.sentTo !== null && row.sentTo !== row.toMobile,
  };
}

export type MessageDto = ReturnType<typeof toMessageDto>;

/**
 * A client's own message as the browser sees it (docs/decisions/0026-whatsapp-webhook.md Amendment 1, the card's "The
 * client wrote"): its words and kind, when it came, and who wrote when it wasn't the client's own number. The
 * provider's ids stay on the server.
 */
export function toReplyDto(row: InboundMessage & { client: Pick<Client, "mobile"> | null }) {
  return {
    id: row.id,
    /** "text", "image", "document", "audio", "reaction"…, as the provider names it. */
    type: row.type,
    /** The words: the text, a caption, the button tapped or the emoji. Null for, e.g., a photo without words. */
    text: row.text,
    receivedAt: row.receivedAt,
    /**
     * Who wrote, when it wasn't the client's main number: "test" outside production (WHATSAPP_TEST_NUMBER, as the card
     * says "to your test number"), else the number, such as a family member's.
     */
    from: row.fromMobile === row.client?.mobile ? null : !isProduction && row.fromMobile === env.WHATSAPP_TEST_NUMBER ? "test" : row.fromMobile,
  };
}

export type ReplyDto = ReturnType<typeof toReplyDto>;
