import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { QUEUES, queueJob } from "../../lib/jobs";
import { logger } from "../../lib/logger";
import { isUniqueViolation } from "../../lib/prismaErrors";
import type { WhatsAppEvent } from "../../lib/whatsapp";
import { recordStatus } from "./messages.service";

// What a WhatsApp provider's webhook reports (docs/decisions/0026-whatsapp-webhook.md), in the CRM's words: where our
// messages have got to, and the clients' own messages. Each is recorded once, however often the provider sends it. A
// client's words are kept on the message, never in the log or the audit.

type StatusEvent = Extract<WhatsAppEvent, { kind: "status" }>;
type IncomingEvent = Extract<WhatsAppEvent, { kind: "incoming" }>;

/** A status for a message whose id isn't saved yet is tried once more this long after: the send job saves it then. */
const LATER_MS = 60_000;

/** The "whatsapp-status-later" job's data: a status, as JSON. */
export interface LaterStatus {
  provider: string;
  event: Omit<StatusEvent, "at"> & { at: string };
}

/** Records what one webhook call brought, in order. Throws when the database can't take it, and the provider calls again. */
export async function recordWhatsAppEvents(provider: string, events: WhatsAppEvent[]): Promise<void> {
  for (const event of events) {
    if (event.kind === "status") await recordReported(provider, event, { later: false });
    else await saveIncoming(provider, event);
  }
}

/** The "whatsapp-status-later" job: a status that came before its message's id was saved, tried once more. */
export async function recordLaterStatus({ provider, event }: LaterStatus): Promise<void> {
  await recordReported(provider, { ...event, at: new Date(event.at) }, { later: true });
}

/**
 * A provider can report on a message before the send job has saved its id (it answers the send and calls the webhook
 * at nearly the same moment), so a status for an id not known yet is tried again a minute later. Still unknown then,
 * it isn't ours: a test message, or one sent from elsewhere.
 */
async function recordReported(provider: string, event: StatusEvent, { later }: { later: boolean }) {
  const message = await prisma.outboundMessage.findUnique({
    where: { provider_providerMessageId: { provider, providerMessageId: event.providerMessageId } },
    select: { id: true },
  });
  if (message) {
    await prisma.$transaction((tx) => recordStatus(tx, message.id, { status: event.status, error: event.error, at: event.at }));
    return;
  }
  if (later) {
    logger.info({ provider, status: event.status }, "A WhatsApp status for a message the CRM didn't send (a test message?); left out.");
    return;
  }
  const data: LaterStatus = { provider, event: { ...event, at: event.at.toISOString() } };
  await queueJob(prisma, QUEUES.whatsappStatusLater, data, { startAfter: new Date(Date.now() + LATER_MS) });
}

/** Keeps a client's message, tied to the case it answers when that can be told, and audits it (its type, not its words). */
async function saveIncoming(provider: string, event: IncomingEvent) {
  try {
    await prisma.$transaction(async (tx) => {
      const key = { provider, providerMessageId: event.providerMessageId };
      // The provider called again with the same message.
      if (await tx.inboundMessage.findUnique({ where: { provider_providerMessageId: key }, select: { id: true } })) return;
      const { clientId, enquiryId } = await whoseCase(tx, provider, event);
      const saved = await tx.inboundMessage.create({
        data: {
          ...key,
          fromMobile: event.from,
          clientId,
          enquiryId,
          type: event.type,
          text: event.text,
          replyToProviderMessageId: event.replyTo,
          receivedAt: event.at,
        },
      });
      await audit(
        {
          action: "message.received",
          entityType: "InboundMessage",
          entityId: saved.id,
          clientId,
          after: { type: event.type, ...(enquiryId ? { enquiryId } : {}) },
        },
        tx,
      );
    });
  } catch (err) {
    // Two calls with the same message at once: the other one kept it.
    if (!isUniqueViolation(err)) throw err;
  }
}

/**
 * The client and case a message is about: those of our message it replies or reacts to; else of the last message we
 * sent to that number; else a client with that number (main, extra or a family member's), without a case.
 */
async function whoseCase(tx: Db, provider: string, event: IncomingEvent): Promise<{ clientId: string | null; enquiryId: string | null }> {
  if (event.replyTo) {
    const answered = await tx.outboundMessage.findUnique({
      where: { provider_providerMessageId: { provider, providerMessageId: event.replyTo } },
      select: { clientId: true, enquiryId: true },
    });
    if (answered) return answered;
  }
  const last = await tx.outboundMessage.findFirst({
    where: { sentTo: event.from },
    orderBy: { sentAt: "desc" },
    select: { clientId: true, enquiryId: true },
  });
  if (last) return last;
  const client =
    (await tx.client.findUnique({ where: { mobile: event.from }, select: { id: true } })) ??
    (await tx.client.findFirst({
      where: { OR: [{ phones: { some: { mobile: event.from } } }, { members: { some: { mobile: event.from, archivedAt: null } } }] },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    }));
  return { clientId: client?.id ?? null, enquiryId: null };
}
