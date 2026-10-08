import app from "./app";
import { env } from "./config/env";
import { prisma } from "./config/prisma";
import { deleteExpiredSessions } from "./modules/auth/session";

/** How often expired sessions are swept out of the database. */
const SESSION_SWEEP_MS = 60 * 60 * 1000;
/** If open requests haven't finished by then, stop anyway. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

const server = app.listen(env.PORT, () => {
  console.log(`Server running on http://localhost:${env.PORT}`);
});

const sweepSessions = () => {
  deleteExpiredSessions().catch((err: unknown) => console.error("Couldn't delete expired sessions:", err));
};
sweepSessions();
const sweepTimer = setInterval(sweepSessions, SESSION_SWEEP_MS);
sweepTimer.unref();

const shutdown = (signal: string) => {
  console.log(`${signal} received, shutting down...`);
  clearInterval(sweepTimer);
  setTimeout(() => {
    console.error("Open requests didn't finish in time; exiting.");
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
