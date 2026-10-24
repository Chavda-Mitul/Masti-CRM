import { prisma } from "../../config/prisma";
import { toMessageDto, toReplyDto } from "../messages/message";
import type { UserWithDepartments } from "../users/user";
import { findVisibleCase } from "./caseLock";

// The case's "Sent to the client" card (docs/decisions/0021-whatsapp-outbox.md): what the CRM has told the client
// about this case, oldest first, like a chat; and under it what the client wrote back, newest first
// (docs/decisions/0026-whatsapp-webhook.md Amendment 1). Its own request, not part of the case, so the card can refresh
// by itself.

/** Anyone who can open the case. */
export async function getCaseMessages(caseNo: string, user: UserWithDepartments) {
  const { id } = await findVisibleCase(caseNo, user);
  const [messages, replies] = await Promise.all([
    prisma.outboundMessage.findMany({
      where: { enquiryId: id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      include: { template: { select: { name: true } }, attachment: { select: { fileName: true } } },
    }),
    prisma.inboundMessage.findMany({
      where: { enquiryId: id },
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      include: { client: { select: { mobile: true } } },
    }),
  ]);
  return { messages: messages.map(toMessageDto), replies: replies.map(toReplyDto) };
}
