import { boss, QUEUES } from "../../lib/jobs";
import { runCombineScansJob, type CombineScansJob } from "./visaCombineScans.service";

/**
 * Combines a visa case's scans into its saved file (0008 Amendment 1): pg-boss runs the job "Mark documents complete"
 * or "File ready" queued. Not in tests, where pg-boss runs no workers: they call runCombineScansJob.
 */
export async function startCombineScans(): Promise<void> {
  await boss.work<CombineScansJob>(QUEUES.visaCombineScans, async (jobs) => {
    for (const job of jobs) await runCombineScansJob(job.data);
  });
}
