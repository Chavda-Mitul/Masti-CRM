import { boss, QUEUES } from "../../lib/jobs";
import { sendDueReminders } from "./visaReminders.service";

/**
 * The pending-document reminders (message 3, 0021 amendment 3): pg-boss runs the sweep every 15 minutes, India time.
 * Not in tests, where pg-boss runs no schedules: they call sendDueReminders with the time they want.
 */
export async function startVisaReminders(): Promise<void> {
  await boss.schedule(QUEUES.visaDocumentReminders, "*/15 * * * *", null, { tz: "Asia/Kolkata" });
  await boss.work(QUEUES.visaDocumentReminders, async () => {
    await sendDueReminders();
  });
}
