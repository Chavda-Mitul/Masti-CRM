import { prisma } from "../../config/prisma";
import { toMessageDto } from "../messages/message";
import type { UserWithDepartments } from "../users/user";
import { findVisibleCase } from "./caseLock";

// The case's "Sent to the client" card (docs/decisions/0021-whatsapp-outbox.md): what the CRM has told the client
// about this case, oldest first, like a chat. Its own request, not part of the case, so the card can refresh by itself
// while a message is on its way.

/** Anyone who can open the case. */
export async function getCaseMessages(caseNo: string, user: UserWithDepartments) {
  const { id } = await findVisibleCase(caseNo, user);
  const rows = await prisma.outboundMessage.findMany({
    where: { enquiryId: id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { template: { select: { name: true } }, attachment: { select: { fileName: true } } },
  });
  return rows.map(toMessageDto);
}
