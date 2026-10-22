import type { CaseFile, MessageTemplate, OutboundMessage } from "../../../generated/prisma/client";
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
