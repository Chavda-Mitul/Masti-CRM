import { PgBoss, fromPrisma, type QueueOptions, type SendOptions } from "pg-boss";
import { env } from "../config/env";
import type { Db } from "../config/prisma";
import { logger } from "./logger";

// The job queue (docs/decisions/0021-whatsapp-outbox.md): pg-boss keeps jobs in this same Postgres, in its own
// "pgboss" schema that Prisma doesn't manage, and runs them inside the server with retries. A job is queued in the
// transaction of the change it follows (queueJob), so a save that rolls back leaves no job behind.

export const QUEUES = {
  /** Sends one OutboundMessage. */
  whatsappSend: "whatsapp-send",
  /** Asks the provider where a sent message has got to. */
  whatsappStatus: "whatsapp-status",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

const QUEUE_OPTIONS: Record<QueueName, QueueOptions> = {
  // Retries after about 1, 2, 4, 8 and 15 minutes, then the message is marked failed. A try that hasn't finished in
  // 2 minutes counts as stuck (Twilio itself gives up after 30 seconds).
  [QUEUES.whatsappSend]: { retryLimit: 5, retryDelay: 60, retryBackoff: true, retryDelayMax: 900, expireInSeconds: 120 },
  // A check that fails is tried once more a minute later; the next check is queued by the last one.
  [QUEUES.whatsappStatus]: { retryLimit: 1, retryDelay: 60, expireInSeconds: 60 },
};

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
  for (const [name, options] of Object.entries(QUEUE_OPTIONS)) {
    if (await boss.getQueue(name)) await boss.updateQueue(name, options);
    else await boss.createQueue(name, options);
  }
}

/** Lets running jobs finish, for up to 10 seconds. */
export async function stopJobs(): Promise<void> {
  await boss.stop({ graceful: true, timeout: 10_000 });
}

/** Queues a job in the caller's transaction (or straight away with `prisma`): it exists only once that commits. */
export async function queueJob(db: Db, queue: QueueName, data: object, options: Omit<SendOptions, "db"> = {}) {
  return boss.send(queue, data, { ...options, db: fromPrisma(db) });
}
