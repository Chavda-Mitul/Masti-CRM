import { randomUUID } from "node:crypto";
import type { OutboundMessage, Prisma } from "../../../generated/prisma/client";
import { env, isProduction } from "../../config/env";
import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { QUEUES, queueJob } from "../../lib/jobs";
import { logger } from "../../lib/logger";
import { sendWhatsApp, whatsAppProvider, WhatsAppError, type WhatsAppStatus } from "../../lib/whatsapp";

// The WhatsApp outbox (docs/decisions/0021-whatsapp-outbox.md). queueMessage writes a message in the transaction of the
// change it reports and queues the "whatsapp-send" job, which deliverMessage runs once that commits. A save never waits
// on WhatsApp, and a message never goes twice: a try that never came back is marked failed, not repeated.

/** A message that couldn't go within this long isn't sent at all: its news would be stale. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** When to ask the provider where a sent message has got to: 1 min, 5 min, 15 min, 1 h, 4 h and 12 h after it went. */
const STATUS_CHECKS_AFTER_SENT_SECONDS = [60, 300, 900, 3600, 14_400, 43_200];

/** When check number `check` is due: so long after the message went (pg-boss runs one already past at once). */
function checkAt(sentAt: Date, check: number): Date | undefined {
  const seconds = STATUS_CHECKS_AFTER_SENT_SECONDS[check];
  return seconds === undefined ? undefined : new Date(sentAt.getTime() + seconds * 1000);
}

const STUCK = "The server stopped while sending this, so it may or may not have gone. Check the chat.";

export interface NewMessage {
  /** MessageTemplate.code */
  template: string;
  clientId: string;
  enquiryId?: string | null;
  /** One per event ("visa.documents_received:<enquiryId>"): the same event never queues a second message. */
  key: string;
  /** A value for each of the template's placeholders. Values it doesn't use are left out. */
  variables: Record<string, string>;
}

/**
 * Writes one message to the client's main number, worded now, and queues its sending, in the caller's transaction: if
 * the change rolls back, so does the message. Does nothing when the same key was queued before.
 */
export async function queueMessage(tx: Db, input: NewMessage): Promise<void> {
  const template = await tx.messageTemplate.findUniqueOrThrow({ where: { code: input.template } });
  const client = await tx.client.findUniqueOrThrow({ where: { id: input.clientId }, select: { mobile: true } });
  const { body, variables } = fill(template.body, input.variables);
  const id = randomUUID();
  const { count } = await tx.outboundMessage.createMany({
    data: [
      {
        id,
        templateId: template.id,
        clientId: input.clientId,
        enquiryId: input.enquiryId ?? null,
        toMobile: client.mobile,
        variables,
        body,
        idempotencyKey: input.key,
      },
    ],
    skipDuplicates: true,
  });
  if (count === 1) await queueJob(tx, QUEUES.whatsappSend, { messageId: id }, { id });
}

/** The template's words with every {{placeholder}} filled, and the values it used. A placeholder with no value is a bug. */
export function fill(template: string, values: Record<string, string>) {
  const used: Record<string, string> = {};
  const body = template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`No value for {{${name}}} in the message template.`);
    used[name] = value;
    return value;
  });
  return { body, variables: used };
}

/**
 * The "whatsapp-send" job: sends one queued message, once. Throws to have pg-boss try again later when the failure may
 * pass (Twilio down or busy); on the last try, or when trying again can't help, the message is marked failed instead.
 */
export async function deliverMessage(messageId: string, { lastTry }: { lastTry: boolean }): Promise<void> {
  const claimed = await claim(messageId);
  if (!claimed) return;
  const { message, providerTemplateId, sendingAt } = claimed;
  const to = recipient(message.toMobile);

  let sent: { provider: string; providerMessageId: string };
  try {
    sent = await sendWhatsApp({
      to,
      body: message.body,
      ...(providerTemplateId ? { template: { id: providerTemplateId, variables: message.variables as Record<string, string> } } : {}),
    });
  } catch (err) {
    const error = err instanceof Error && err.message ? err.message : "The message couldn't be sent.";
    const retry = !lastTry && !(err instanceof WhatsAppError && !err.retryable);
    if (retry) {
      await settle(message, sendingAt, { error });
      throw new Error(error, { cause: err });
    }
    await settle(message, sendingAt, { status: "FAILED", error, failedAt: new Date() });
    return;
  }

  const sentAt = new Date();
  await settle(
    message,
    sendingAt,
    { status: "SENT", provider: sent.provider, providerMessageId: sent.providerMessageId, sentTo: to, sentAt, error: null },
    whatsAppProvider()?.checkStatus ? checkAt(sentAt, 0) : undefined,
  );
}

/** Outside production every message goes to the test number (WHATSAPP_TEST_NUMBER), so a laptop never messages a client. */
function recipient(toMobile: string): string {
  return isProduction ? toMobile : (env.WHATSAPP_TEST_NUMBER ?? toMobile);
}

type Claimed = { message: OutboundMessage & { template: { code: string } }; providerTemplateId: string | null; sendingAt: Date };

/** Takes the message for one try, or settles it at once when it mustn't be tried. Null: there's nothing to send. */
async function claim(messageId: string): Promise<Claimed | null> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "OutboundMessage" WHERE "id" = ${messageId} FOR UPDATE`;
    const message = await tx.outboundMessage.findUnique({ where: { id: messageId }, include: { template: true } });
    // Settled already: a repeated job never sends it again.
    if (!message || message.status !== "QUEUED") return null;

    const now = new Date();
    const refusal = whyNotNow(message, now);
    if (refusal) {
      await tx.outboundMessage.update({
        where: { id: messageId },
        data: { ...refusal, sendingAt: null, ...(refusal.status === "FAILED" ? { failedAt: now } : {}) },
      });
      await auditOutcome(tx, message, refusal);
      return null;
    }
    await tx.outboundMessage.update({ where: { id: messageId }, data: { sendingAt: now, attempts: { increment: 1 } } });
    return { message, providerTemplateId: message.template.providerTemplateId, sendingAt: now };
  });
}

/** Why the message mustn't be tried now, if it mustn't. */
function whyNotNow(
  message: OutboundMessage & { template: { isActive: boolean } },
  now: Date,
): { status: "FAILED" | "SKIPPED"; error: string } | null {
  if (message.sendingAt) return { status: "FAILED", error: STUCK };
  if (!message.template.isActive) return { status: "SKIPPED", error: "This message is switched off." };
  if (now.getTime() - message.createdAt.getTime() > MAX_AGE_MS) {
    return { status: "FAILED", error: "It couldn't go within 24 hours, so it wasn't sent at all." };
  }
  try {
    if (!whatsAppProvider()) return { status: "FAILED", error: "WhatsApp isn't set up yet." };
  } catch (err) {
    return { status: "FAILED", error: err instanceof Error ? err.message : String(err) };
  }
  return null;
}

/**
 * Records how a try went, unless the message moved on meanwhile (a second try marked it stuck). A message that's still
 * QUEUED waits for pg-boss's next try. A sent one gets its first status check, when the provider can be asked.
 */
async function settle(
  message: Claimed["message"],
  sendingAt: Date,
  data: Prisma.OutboundMessageUpdateManyMutationInput & { status?: "SENT" | "FAILED" },
  firstCheckAt?: Date,
) {
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.outboundMessage.updateMany({
      where: { id: message.id, status: "QUEUED", sendingAt },
      data: { ...data, sendingAt: null },
    });
    if (count === 0) {
      logger.warn({ messageId: message.id }, "A WhatsApp try finished after its message had moved on; nothing recorded.");
      return;
    }
    if (data.status) await auditOutcome(tx, message, { status: data.status, error: typeof data.error === "string" ? data.error : null });
    if (firstCheckAt) {
      await queueJob(tx, QUEUES.whatsappStatus, { messageId: message.id, check: 0 }, { startAfter: firstCheckAt });
    }
  });
}

async function auditOutcome(
  tx: Db,
  message: Pick<OutboundMessage, "id" | "clientId"> & { template: { code: string } },
  outcome: { status: "SENT" | "FAILED" | "SKIPPED"; error: string | null },
) {
  await audit(
    {
      action: `message.${outcome.status.toLowerCase()}`,
      entityType: "OutboundMessage",
      entityId: message.id,
      clientId: message.clientId,
      after: { template: message.template.code, ...(outcome.error ? { error: outcome.error } : {}) },
    },
    tx,
  );
}

/**
 * The "whatsapp-status" job: asks the provider where a sent message has got to, and asks again at the next check time
 * until it's read or failed, or the checks run out. A provider that can't be asked (an outage) is asked again at the
 * next check, so the message never stays "sent" for want of an answer. Delivered and read are recorded when the CRM
 * learns of them.
 */
export async function checkMessageStatus(messageId: string, check: number): Promise<void> {
  const message = await prisma.outboundMessage.findUnique({ where: { id: messageId }, include: { template: { select: { code: true } } } });
  if (!message?.providerMessageId || !message.sentAt || (message.status !== "SENT" && message.status !== "DELIVERED")) return;
  const provider = whatsAppProvider();
  // A message carried by another provider than today's can't be asked about.
  if (!provider?.checkStatus || provider.name !== message.provider) return;

  let answer: { status: WhatsAppStatus; error: string | null } | null = null;
  try {
    answer = await provider.checkStatus(message.providerMessageId);
  } catch (err) {
    logger.warn({ err, messageId }, "Couldn't ask where a WhatsApp message has got to; asking again at the next check.");
  }
  const now = new Date();
  const status = answer?.status;
  const error = answer?.error ?? null;
  const data: Prisma.OutboundMessageUpdateManyMutationInput | null =
    status === "FAILED"
      ? { status: "FAILED", error: error ?? "It wasn't delivered.", failedAt: now }
      : status === "READ"
        ? { status: "READ", readAt: now, deliveredAt: message.deliveredAt ?? now }
        : status === "DELIVERED" && message.status === "SENT"
          ? { status: "DELIVERED", deliveredAt: now }
          : null;
  const next = checkAt(message.sentAt, check + 1);

  await prisma.$transaction(async (tx) => {
    if (data) {
      const { count } = await tx.outboundMessage.updateMany({ where: { id: messageId, status: message.status }, data });
      if (count === 0) return;
      if (status === "FAILED") await auditOutcome(tx, message, { status: "FAILED", error: error ?? "It wasn't delivered." });
    }
    if (status !== "READ" && status !== "FAILED" && next) {
      await queueJob(tx, QUEUES.whatsappStatus, { messageId, check: check + 1 }, { startAfter: next });
    }
  });
}
