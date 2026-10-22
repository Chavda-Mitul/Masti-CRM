import { prisma } from "../../config/prisma";
import { istToday } from "../../lib/dates";
import { VISA_DOCUMENT_REMINDER } from "../messages/messages.seed";
import { queueMessage } from "../messages/messages.service";
import { getVisaSettings, nextReminderAt } from "./visa.settings";
import { COLLECTING_STAGES, travellerLabel } from "./visaCase";
import { fitList, visaMessageBasics } from "./visaMessages";

// Message 3, "Documents still pending" (docs/whatsapp-visa-messages.md; 0006 amendment 19, 0021 amendment 3): every
// few days at a set time, while a case is still collecting and a paper the client brings is missing. The days are the
// Reminders card's own ("Next: Fri 23 Oct"): every N days from intake, a Sunday or office holiday moved to the next
// open day.

/** How long after its planned time a reminder still goes: the sweep runs every 15 minutes, so 2 hours covers a restart. */
const CATCH_UP_MS = 2 * 60 * 60 * 1000;

/** "Rakesh" for "Rakesh Mehta": how a message names a traveller. */
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** A paper the client brings and hasn't: what we arrange (flights, hotels, insurance) is never asked for. */
const missing = { status: "PENDING" as const, requirement: { not: "ARRANGED_BY_US" as const } };

/**
 * The "visa-document-reminders" job, every 15 minutes: queues message 3 for each case whose planned reminder time came
 * in the last 2 hours, keyed per planned day so it goes once. Nothing goes while reminders are off in Settings or on
 * the case, or set to SMS (not built yet).
 */
export async function sendDueReminders(now: Date = new Date()): Promise<void> {
  const { documentReminders: setting } = await getVisaSettings();
  if (!setting.enabled || setting.channel !== "WHATSAPP") return;
  const cases = await prisma.enquiry.findMany({
    where: {
      status: "OPEN",
      stage: { code: { in: COLLECTING_STAGES } },
      visa: { remindersOn: true, travellers: { some: { documents: { some: missing } } } },
    },
    select: {
      id: true,
      createdAt: true,
      visa: {
        select: {
          travellers: {
            orderBy: { position: "asc" },
            select: { position: true, isChild: true, name: true, documents: { where: missing, orderBy: { sortOrder: "asc" }, select: { name: true } } },
          },
        },
      },
    },
  });

  for (const c of cases) {
    const due = await nextReminderAt(istToday(c.createdAt), setting, prisma, new Date(now.getTime() - CATCH_UP_MS));
    if (!due || due.getTime() > now.getTime()) continue;
    const travellers = c.visa!.travellers;
    const adults = travellers.filter((t) => !t.isChild).length;
    const pending = travellers.flatMap((t) => t.documents.map((d) => `${d.name} (${t.name ? firstName(t.name) : travellerLabel(t, adults)})`));
    await prisma.$transaction(async (tx) => {
      const basics = await visaMessageBasics(tx, c.id);
      await queueMessage(tx, {
        template: VISA_DOCUMENT_REMINDER,
        enquiryId: c.id,
        key: `${VISA_DOCUMENT_REMINDER}:${c.id}:${istToday(due)}`,
        clientId: basics.clientId,
        variables: { ...basics.variables, pending_list: fitList(pending) },
      });
    });
  }
}
