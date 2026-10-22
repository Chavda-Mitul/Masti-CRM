import { prisma } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { notFound } from "../../lib/httpError";
import { getObject } from "../../lib/storage";
import { contentTypeOf, keyMatches } from "./messageFiles";

// The file a WhatsApp message carries, for the provider that sends it (docs/decisions/0025-evisa-after-decision.md,
// part 2). No login: the link's key is the permission, and only while the link works. Every way it can be wrong (an
// unknown message, one with no file, a wrong or old key) gets the same answer, which gives nothing away.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GONE = "This link doesn't work any more.";

/**
 * The file's type, name and size, for a GET or a HEAD; with `withBytes` (a GET) its bytes too, read from the bucket,
 * and the fetch is audited (message.file.fetch), as staff opening a file is.
 */
export async function fetchMessageFile(messageId: string, key: string, { withBytes, ip }: { withBytes: boolean; ip: string | null }) {
  if (!UUID.test(messageId) || !key) throw notFound(GONE);
  const message = await prisma.outboundMessage.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      clientId: true,
      attachmentKeyHash: true,
      attachmentKeyExpiresAt: true,
      attachment: { select: { id: true, storageKey: true, fileName: true, sizeBytes: true } },
    },
  });
  const file = message?.attachment;
  if (!message || !file || !message.attachmentKeyHash || !message.attachmentKeyExpiresAt) throw notFound(GONE);
  if (message.attachmentKeyExpiresAt.getTime() <= Date.now() || !keyMatches(key, message.attachmentKeyHash)) throw notFound(GONE);

  const shown = { contentType: contentTypeOf(file.fileName), fileName: file.fileName, sizeBytes: file.sizeBytes };
  if (!withBytes) return { ...shown, bytes: null };
  const bytes = await getObject(file.storageKey);
  await audit({
    action: "message.file.fetch",
    entityType: "OutboundMessage",
    entityId: message.id,
    clientId: message.clientId,
    after: { fileId: file.id, fileName: file.fileName },
    ip,
  });
  return { ...shown, bytes };
}
