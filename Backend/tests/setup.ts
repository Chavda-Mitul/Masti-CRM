import { afterAll, beforeAll } from "vitest";
import { boss, startJobs, stopJobs } from "../src/lib/jobs";

// pg-boss runs in every test file, without workers, so a save can queue its jobs (docs/decisions/0021-whatsapp-outbox.md).
// The tests do a job's work by calling it, and look at the queued jobs with boss.findJobs.

beforeAll(async () => {
  await startJobs();
  await boss.deleteAllJobs();
});

afterAll(async () => {
  await stopJobs();
});
