import { boss, QUEUES } from "../../lib/jobs";
import { checkMessageStatus, deliverMessage } from "./messages.service";

// The outbox's two jobs (docs/decisions/0021-whatsapp-outbox.md), run by pg-boss inside the server. One job at a time
// each: messages come a few a minute, far below anything WhatsApp limits.

export async function registerMessageWorkers(): Promise<void> {
  // With includeMetadata each job carries retryCount and retryLimit, which tell the last try.
  await boss.work<{ messageId: string }, void, { includeMetadata: true }>(QUEUES.whatsappSend, { includeMetadata: true }, async (jobs) => {
    for (const job of jobs) await deliverMessage(job.data.messageId, { lastTry: job.retryCount >= job.retryLimit });
  });
  await boss.work<{ messageId: string; check: number }>(QUEUES.whatsappStatus, async (jobs) => {
    for (const job of jobs) await checkMessageStatus(job.data.messageId, job.data.check);
  });
}
