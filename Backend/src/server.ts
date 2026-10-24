import app from "./app";
import { env } from "./config/env";
import { prisma } from "./config/prisma";
import { startJobs, stopJobs, stopWorkers } from "./lib/jobs";
import { logger } from "./lib/logger";
import { deleteExpiredSessions } from "./modules/auth/session";
import { seedConsentFields, seedConsentWording } from "./modules/consent/consent.seed";
import { startMessages } from "./modules/messages/messages.worker";
import { startCombineScans } from "./modules/visa/visaCombineScans.worker";
import { startVisaReminders } from "./modules/visa/visaReminders.worker";

/** How often expired sessions are swept out of the database. */
const SESSION_SWEEP_MS = 60 * 60 * 1000;
/** If open requests haven't finished by then, stop anyway. */
const SHUTDOWN_TIMEOUT_MS = 15_000;

// A crash stops the server as Node would, but lands in the log first.
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception; stopping.");
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "Unhandled promise rejection; stopping.");
  process.exit(1);
});

async function main() {
  // The job queue first (docs/decisions/0021-whatsapp-outbox.md): a save may queue a job, so requests wait for it.
  await startJobs();
  await startMessages();
  // The visa pending-document reminders, every 15 minutes (message 3, 0021 amendment 3).
  await startVisaReminders();
  // A visa case's scans combined into its saved file after "File ready" (0008 Amendment 1).
  await startCombineScans();
  // The consent form needs a wording and fields: the drafts, into a database with none (docs/decisions/0022-consent-form.md).
  await seedConsentWording(prisma);
  await seedConsentFields(prisma);

  const server = app.listen(env.PORT, () => {
    logger.info(`Server running on http://localhost:${env.PORT}`);
  });

  const sweepSessions = () => {
    deleteExpiredSessions().catch((err: unknown) => logger.error({ err }, "Couldn't delete expired sessions."));
  };
  sweepSessions();
  const sweepTimer = setInterval(sweepSessions, SESSION_SWEEP_MS);
  sweepTimer.unref();

  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down...`);
    clearInterval(sweepTimer);
    setTimeout(() => {
      logger.error("Open requests didn't finish in time; exiting.");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();
    // Requests and job workers wind down side by side, so a message being sent gets the whole grace period to finish
    // (and isn't left marked as sending) however long a request takes. pg-boss itself stops last: a request still
    // running may queue a message.
    const requestsDone = new Promise<void>((resolve) => server.close(() => resolve()));
    // Browsers keep idle connections open; close them so server.close() can finish.
    server.closeIdleConnections();
    Promise.all([requestsDone, stopWorkers()])
      .then(() => stopJobs())
      .then(() => prisma.$disconnect())
      .then(
        () => process.exit(0),
        (err: unknown) => {
          logger.error({ err }, "Couldn't shut down cleanly.");
          process.exit(1);
        },
      );
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  logger.fatal({ err }, "The server couldn't start.");
  process.exit(1);
});
