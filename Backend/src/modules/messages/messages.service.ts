import { randomUUID } from "node:crypto";
import type { OutboundMessage, Prisma } from "../../../generated/prisma/client";
import { env, isProduction } from "../../config/env";
import { prisma, type Db } from "../../config/prisma";
import { audit } from "../../lib/audit";
import { QUEUES, queueJob } from "../../lib/jobs";
import { logger } from "../../lib/logger";
import { sendWhatsApp, whatsAppProvider, WhatsAppError, type WhatsAppStatus } from "../../lib/whatsapp";
import { hideSecrets, secretValues } from "../../lib/whatsapp/secrets";
import { maskConsentLinks } from "../consent/consentToken";
import { newFileLink } from "./messageFiles";

// The WhatsApp outbox (docs/decisions/0021-whatsapp-outbox.md). queueMessage writes a message in the transaction of the
// change it reports and queues the "whatsapp-send" job, which deliverMessage runs once that commits. A save never waits
// on WhatsApp, and a message never goes twice: a try that never came back is marked failed, not repeated. A message can
// carry one of its case's files, which the provider fetches through the CRM's own short-lived link
// (docs/decisions/0025-evisa-after-decision.md, part 2; messageFiles.ts).

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
  /** Another number than the client's main one: a traveller's own, for their consent link (0022). +91XXXXXXXXXX. */
  toMobile?: string;
  /**
   * One of this case's files, sent with the words (docs/decisions/0025-evisa-after-decision.md, part 2): an e-visa's
   * PDF. The provider fetches it through the CRM's own short-lived link, made at each try.
   */
  attachmentId?: string;
}

/**
 * Writes one message to the client's main number (or `toMobile`), worded now, and queues its sending, in the caller's transaction: if
 * the change rolls back, so does the message. Does nothing when the same key was queued before.
 *
 * A message problem never stops the change it reports. A wording the CRM can't fill is written down as failed, with
 * the reason, and isn't sent; a missing wording (the server adds them when it starts) is only logged.
 */
export async function queueMessage(tx: Db, input: NewMessage): Promise<void> {
  const template = await tx.messageTemplate.findUnique({ where: { code: input.template } });
  if (!template) {
    logger.error({ template: input.template, key: input.key }, "No wording for this WhatsApp message, so it wasn't written.");
    return;
  }
  if (input.attachmentId) {
    // A client must never get another case's file: a wrong file is a bug in the caller, so the change stops.
    const file = await tx.caseFile.findUnique({ where: { id: input.attachmentId }, select: { enquiryId: true } });
    if (!file || !input.enquiryId || file.enquiryId !== input.enquiryId) throw new Error("The file to send with a WhatsApp message isn't this case's.");
  }
  const client = await tx.client.findUniqueOrThrow({ where: { id: input.clientId }, select: { mobile: true } });
  let filled: { body: string; variables: Record<string, string> } | null = null;
  let problem: string | null = null;
  try {
    filled = fill(template.body, input.variables);
  } catch (err) {
    problem = err instanceof Error ? err.message : String(err);
    logger.error({ template: input.template, key: input.key, problem }, "A WhatsApp wording couldn't be filled; the message is marked failed.");
  }

  const id = randomUUID();
  const words = { body: filled?.body ?? template.body, variables: filled?.variables ?? input.variables };
  const { count } = await tx.outboundMessage.createMany({
    data: [
      {
        id,
        templateId: template.id,
        clientId: input.clientId,
        enquiryId: input.enquiryId ?? null,
        attachmentId: input.attachmentId ?? null,
        toMobile: input.toMobile ?? client.mobile,
        ...(problem ? withoutSecrets(words) : words),
        idempotencyKey: input.key,
        ...(problem ? { status: "FAILED" as const, error: problem, failedAt: new Date() } : {}),
      },
    ],
    skipDuplicates: true,
  });
  if (count === 0) return;
  if (problem) await auditOutcome(tx, { id, clientId: input.clientId, template }, { status: "FAILED", error: problem });
  else await queueJob(tx, QUEUES.whatsappSend, { messageId: id }, { id });
}

/** The template's words with every {{placeholder}} filled, and the values it used. Throws for a placeholder with no value. */
export function fill(template: string, values: Record<string, string>) {
  const used: Record<string, string> = {};
  const body = template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`The wording has {{${name}}}, which the CRM can't fill, so it wasn't sent.`);
    used[name] = value;
    return value;
  });
  return { body, variables: used };
}

/**
 * The words and values a settled message keeps: a consent link's secret and the door code are the client's alone, and
 * once the message has gone, or won't go, nothing needs them (docs/decisions/0022-consent-form.md, amendment 6 here).
 * Only a queued message holds them, for its try.
 */
function withoutSecrets(message: { body: string; variables: Prisma.JsonValue }) {
  const variables = message.variables as Record<string, string>;
  const secrets = secretValues(variables);
  const hide = (text: string) => maskConsentLinks(hideSecrets(text, secrets));
  return {
    body: hide(message.body),
    variables: Object.fromEntries(Object.entries(variables).map(([name, value]) => [name, hide(value)])),
  };
}

/**
 * The "whatsapp-send" job: sends one queued message, once. Throws to have pg-boss try again later when the failure may
 * pass (Twilio down or busy); on the last try, or when trying again can't help, the message is marked failed instead.
 */
export async function deliverMessage(messageId: string, { lastTry }: { lastTry: boolean }): Promise<void> {
  const claimed = await claim(messageId);
  if (!claimed) return;
  const { message, providerTemplateId, sendingAt, attachment } = claimed;
  const to = recipient(message.toMobile);

  let sent: { provider: string; providerMessageId: string };
  try {
    const variables = message.variables as Record<string, string>;
    const secrets = secretValues(variables);
    sent = await sendWhatsApp({
      to,
      body: message.body,
      ...(providerTemplateId ? { template: { id: providerTemplateId, variables } } : {}),
      ...(attachment ? { attachment } : {}),
      ...(secrets.length > 0 ? { secrets } : {}),
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

type Claimed = {
  message: OutboundMessage & { template: { code: string } };
  providerTemplateId: string | null;
  sendingAt: Date;
  /** The file's link for this try, and its name (0025, part 2). */
  attachment: { url: string; fileName: string } | null;
};

/**
 * Takes the message for one try, or settles it at once when it mustn't be tried. Null: there's nothing to send. A
 * message with a file gets a new link for this try, whose key only the provider is given; an earlier try's stops working.
 */
async function claim(messageId: string): Promise<Claimed | null> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "OutboundMessage" WHERE "id" = ${messageId} FOR UPDATE`;
    const message = await tx.outboundMessage.findUnique({
      where: { id: messageId },
      include: { template: true, attachment: { select: { fileName: true } } },
    });
    // Settled already: a repeated job never sends it again.
    if (!message || message.status !== "QUEUED") return null;

    const now = new Date();
    const refusal = whyNotNow(message, now);
    if (refusal) {
      await tx.outboundMessage.update({
        where: { id: messageId },
        data: { ...refusal, ...withoutSecrets(message), sendingAt: null, ...(refusal.status === "FAILED" ? { failedAt: now } : {}) },
      });
      await auditOutcome(tx, message, refusal);
      return null;
    }
    const link = message.attachment ? newFileLink(message.id, message.attachment.fileName, now) : null;
    await tx.outboundMessage.update({
      where: { id: messageId },
      data: {
        sendingAt: now,
        attempts: { increment: 1 },
        ...(link ? { attachmentKeyHash: link.keyHash, attachmentKeyExpiresAt: link.expiresAt } : {}),
      },
    });
    const attachment = link && message.attachment ? { url: link.url, fileName: message.attachment.fileName } : null;
    return { message, providerTemplateId: message.template.providerTemplateId, sendingAt: now, attachment };
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
 * QUEUED waits for pg-boss's next try. A settled one loses its secrets; a sent one gets its first status check, when the
 * provider can be asked.
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
      data: { ...data, ...(data.status ? withoutSecrets(message) : {}), sendingAt: null },
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

/**
 * The "whatsapp-send-failed" job: pg-boss gave up on a message's sending because its last try failed before it could
 * record how it went (the database was out of reach, or the try got stuck). A message still waiting is marked failed
 * then, so none stays queued for ever; one caught mid-try may have gone.
 */
export async function giveUpMessage(messageId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "OutboundMessage" WHERE "id" = ${messageId} FOR UPDATE`;
    const message = await tx.outboundMessage.findUnique({ where: { id: messageId }, include: { template: { select: { code: true } } } });
    if (!message || message.status !== "QUEUED") return;
    const error = message.sendingAt ? STUCK : `It couldn't be sent${message.error ? `: ${message.error}` : "."}`;
    await tx.outboundMessage.update({
      where: { id: messageId },
      data: { status: "FAILED", error, failedAt: new Date(), sendingAt: null, ...withoutSecrets(message) },
    });
    await auditOutcome(tx, message, { status: "FAILED", error });
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
  const message = await prisma.outboundMessage.findUnique({ where: { id: messageId } });
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
  const next = checkAt(message.sentAt, check + 1);

  await prisma.$transaction(async (tx) => {
    const settled = await recordStatus(tx, messageId, answer && { ...answer, at: new Date() });
    if (!settled && next) await queueJob(tx, QUEUES.whatsappStatus, { messageId, check: check + 1 }, { startAfter: next });
  });
}

/** Where a provider says a sent message has got to, and when: by its own clock when it says (a webhook), else now. */
export interface StatusReport {
  status: WhatsAppStatus;
  /** Why it wasn't delivered, in plain words, when it failed. */
  error: string | null;
  at: Date;
}

/**
 * Records a provider's report on a sent message, from a status check or a webhook (docs/decisions/0026-whatsapp-webhook.md):
 * forward only, sent → delivered → read, or failed with its reason (audited). A repeated report, or one that comes late
 * (delivered after read), changes nothing. The row is locked, so two reports arriving together can't undo each other.
 * True once the message is settled (read, failed, or not a sent message at all), when no later report can change it.
 */
export async function recordStatus(tx: Db, messageId: string, report: StatusReport | null): Promise<boolean> {
  await tx.$queryRaw`SELECT "id" FROM "OutboundMessage" WHERE "id" = ${messageId} FOR UPDATE`;
  const message = await tx.outboundMessage.findUnique({ where: { id: messageId }, include: { template: { select: { code: true } } } });
  if (!message || (message.status !== "SENT" && message.status !== "DELIVERED")) return true;
  const change = report && statusChange(message, report);
  if (!change) return false;
  await tx.outboundMessage.update({ where: { id: messageId }, data: change });
  if (change.status === "FAILED") await auditOutcome(tx, message, { status: "FAILED", error: change.error });
  return change.status !== "DELIVERED";
}

/** What a report changes on a sent or delivered message, or null when it changes nothing. */
function statusChange(
  message: Pick<OutboundMessage, "status" | "deliveredAt">,
  { status, error, at }: StatusReport,
): { status: "FAILED"; error: string; failedAt: Date } | { status: "READ"; readAt: Date; deliveredAt: Date } | { status: "DELIVERED"; deliveredAt: Date } | null {
  if (status === "FAILED") return { status: "FAILED", error: error ?? "It wasn't delivered.", failedAt: at };
  if (status === "READ") return { status: "READ", readAt: at, deliveredAt: message.deliveredAt ?? at };
  if (status === "DELIVERED" && message.status === "SENT") return { status: "DELIVERED", deliveredAt: at };
  return null;
}
