import { PgBoss, fromPrisma, type Queue, type SendOptions } from "pg-boss";
import { env } from "../config/env";
import type { Db } from "../config/prisma";
import { logger } from "./logger";

// The job queue (docs/decisions/0021-whatsapp-outbox.md): pg-boss keeps jobs in this same Postgres, in its own
// "pgboss" schema that Prisma doesn't manage, and runs them inside the server with retries. A job is queued in the
// transaction of the change it follows (queueJob), so a save that rolls back leaves no job behind.

export const QUEUES = {
  /** Sends one OutboundMessage. */
  whatsappSend: "whatsapp-send",
  /** pg-boss gave up sending a message (its last try failed before it could say how it went): marks it failed. */
  whatsappSendFailed: "whatsapp-send-failed",
  /** Asks the provider where a sent message has got to. */
  whatsappStatus: "whatsapp-status",
  /** A webhook's status for a message whose id wasn't saved yet, tried once more (docs/decisions/0026-whatsapp-webhook.md). */
  whatsappStatusLater: "whatsapp-status-later",
  /** Every 15 minutes: queues the visa pending-document reminders that are due (message 3). */
  visaDocumentReminders: "visa-document-reminders",
  /** After "Mark documents complete" and "File ready": combines the visa case's scans into its saved file (0008 Amendment 1). */
  visaCombineScans: "visa-combine-scans",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

type QueueSettings = Pick<Queue, "retryLimit" | "retryDelay" | "retryBackoff" | "retryDelayMax" | "expireInSeconds" | "deadLetter">;

// In the order they are created: a dead letter queue must exist before a queue names it.
const QUEUE_SETTINGS: [QueueName, QueueSettings][] = [
  // Keeps trying for hours: it runs when the database was out of reach, and must mark the message once it's back.
  [QUEUES.whatsappSendFailed, { retryLimit: 10, retryDelay: 60, retryBackoff: true, retryDelayMax: 3600, expireInSeconds: 60 }],
  // Retries after about 1, 2, 4, 8 and 15 minutes, then the message is marked failed. A try that hasn't finished in
  // 2 minutes counts as stuck (Twilio itself gives up after 30 seconds). A job pg-boss gives up on goes to the queue
  // above, so no message stays queued for ever.
  [
    QUEUES.whatsappSend,
    { retryLimit: 5, retryDelay: 60, retryBackoff: true, retryDelayMax: 900, expireInSeconds: 120, deadLetter: QUEUES.whatsappSendFailed },
  ],
  // A check that fails is tried once more a minute later; the next check is queued by the last one.
  [QUEUES.whatsappStatus, { retryLimit: 1, retryDelay: 60, expireInSeconds: 60 }],
  // A late status that fails (the database out of reach) is tried once more a minute later.
  [QUEUES.whatsappStatusLater, { retryLimit: 1, retryDelay: 60, expireInSeconds: 60 }],
  // A sweep that fails isn't tried again: the next one, 15 minutes later, catches up on whatever was due.
  [QUEUES.visaDocumentReminders, { retryLimit: 0, expireInSeconds: 600 }],
  // A try the bucket or the database fails is tried again after about half a minute, 1 and 2 minutes; one that hasn't
  // finished in 5 minutes counts as stuck. Scans missing isn't an error: the job ends, and the case shows what's missing.
  [QUEUES.visaCombineScans, { retryLimit: 3, retryDelay: 30, retryBackoff: true, expireInSeconds: 300 }],
];

export const boss = new PgBoss({
  connectionString: env.DATABASE_URL,
  schema: "pgboss",
  // Tests start pg-boss only to queue jobs: no maintenance and no timed jobs.
  ...(env.NODE_ENV === "test" ? { supervise: false, schedule: false } : {}),
});

// pg-boss reports background trouble as "error" events, and an error event nobody listens to would stop the server.
boss.on("error", (err) => logger.error({ err }, "Job queue error."));

/** Starts pg-boss and brings every queue's settings up to date. Before the server takes requests: a save may queue a job. */
export async function startJobs(): Promise<void> {
  await boss.start();
  for (const [name, settings] of QUEUE_SETTINGS) {
    if (await boss.getQueue(name)) await boss.updateQueue(name, settings);
    else await boss.createQueue(name, settings);
  }
}

/** Stops taking jobs, waiting for the ones running (a send in progress) to finish. Queuing still works. */
export async function stopWorkers(): Promise<void> {
  await Promise.all(Object.values(QUEUES).map((queue) => boss.offWork(queue)));
}

/** Stops pg-boss and closes its connections, after giving anything still running up to 5 seconds. */
export async function stopJobs(): Promise<void> {
  await boss.stop({ graceful: true, timeout: 5_000 });
}

/** Queues a job in the caller's transaction (or straight away with `prisma`): it exists only once that commits. */
export async function queueJob(db: Db, queue: QueueName, data: object, options: Omit<SendOptions, "db"> = {}) {
  return boss.send(queue, data, { ...options, db: fromPrisma(db) });
}
