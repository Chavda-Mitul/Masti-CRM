import app from "./app";
import { env } from "./config/env";
import { prisma } from "./config/prisma";
import { logger } from "./lib/logger";
import { deleteExpiredSessions } from "./modules/auth/session";

/** How often expired sessions are swept out of the database. */
const SESSION_SWEEP_MS = 60 * 60 * 1000;
/** If open requests haven't finished by then, stop anyway. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

// A crash stops the server as Node would, but lands in the log first.
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception; stopping.");
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "Unhandled promise rejection; stopping.");
  process.exit(1);
});

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
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  // Browsers keep idle connections open; close them so server.close() can finish.
  server.closeIdleConnections();
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
