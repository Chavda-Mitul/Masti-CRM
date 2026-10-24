import { boss, QUEUES } from "../../lib/jobs";
import { combineScansAfterFileReady, type CombineScansJob } from "./visaCombineScans.service";

/**
 * Combines a visa case's scans into its saved file once it's marked "File ready" (0008 Amendment 1): pg-boss runs the
 * job "File ready" queued. Not in tests, where pg-boss runs no workers: they call combineScansAfterFileReady.
 */
export async function startCombineScans(): Promise<void> {
  await boss.work<CombineScansJob>(QUEUES.visaCombineScans, async (jobs) => {
    for (const job of jobs) await combineScansAfterFileReady(job.data);
  });
}
