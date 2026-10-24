import { prisma } from "../../config/prisma";
import { boss, QUEUES } from "../../lib/jobs";
import { seedMessageTemplates } from "./messages.seed";
import { checkMessageStatus, deliverMessage, giveUpMessage } from "./messages.service";
import { recordLaterStatus, type LaterStatus } from "./whatsappWebhook.service";

// The outbox's jobs (docs/decisions/0021-whatsapp-outbox.md), run by pg-boss inside the server. One job at a time each:
// messages come a few a minute, far below anything WhatsApp limits.

/**
 * Starts the outbox: first adds any message wording the database lacks (never changing one that's there), so a step
 * that queues a message can't fail for want of it, then runs the jobs.
 */
export async function startMessages(): Promise<void> {
  await seedMessageTemplates(prisma);
  await registerMessageWorkers();
}

export async function registerMessageWorkers(): Promise<void> {
  // With includeMetadata each job carries retryCount and retryLimit, which tell the last try.
  await boss.work<{ messageId: string }, void, { includeMetadata: true }>(QUEUES.whatsappSend, { includeMetadata: true }, async (jobs) => {
    for (const job of jobs) await deliverMessage(job.data.messageId, { lastTry: job.retryCount >= job.retryLimit });
  });
  await boss.work<{ messageId: string }>(QUEUES.whatsappSendFailed, async (jobs) => {
    for (const job of jobs) await giveUpMessage(job.data.messageId);
  });
  await boss.work<{ messageId: string; check: number }>(QUEUES.whatsappStatus, async (jobs) => {
    for (const job of jobs) await checkMessageStatus(job.data.messageId, job.data.check);
  });
  await boss.work<LaterStatus>(QUEUES.whatsappStatusLater, async (jobs) => {
    for (const job of jobs) await recordLaterStatus(job.data);
  });
}
