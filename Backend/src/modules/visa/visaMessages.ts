import type { DocumentRequirement, TravellerGroup } from "../../../generated/prisma/enums";
import type { Db } from "../../config/prisma";
import { getCompanyDetails } from "../company/company.settings";

// What every visa message says about its case (docs/whatsapp-visa-messages.md): {{client_name}}, {{visa}},
// {{case_no}}, {{travellers}} and {{office_phone}}. Each step's message adds its own values to these
// (docs/decisions/0021-whatsapp-outbox.md).

/** "France tourist visa": the country and the visa type, as the messages name the visa. */
export function visaLabel(country: string, visaType: string): string {
  return `${country} ${visaType.toLowerCase()} visa`;
}

/** "1 traveller", "4 travellers". */
export function travellersText(count: number): string {
  return `${count} ${count === 1 ? "traveller" : "travellers"}`;
}

/** The client a case's messages go to, and the values every visa message uses. */
export async function visaMessageBasics(db: Db, enquiryId: string) {
  const enquiry = await db.enquiry.findUniqueOrThrow({
    where: { id: enquiryId },
    select: {
      caseNo: true,
      clientId: true,
      client: { select: { name: true } },
      visa: {
        select: {
          offering: { select: { country: { select: { name: true } }, visaType: { select: { name: true } } } },
          _count: { select: { travellers: true } },
        },
      },
    },
  });
  if (!enquiry.visa) throw new Error(`${enquiry.caseNo} isn't a visa case.`);
  const { country, visaType } = enquiry.visa.offering;
  return {
    clientId: enquiry.clientId,
    variables: {
      client_name: enquiry.client.name,
      visa: visaLabel(country.name, visaType.name),
      case_no: enquiry.caseNo,
      travellers: travellersText(enquiry.visa._count.travellers),
      office_phone: (await getCompanyDetails(db)).phone,
    },
  };
}

/** Room for a list inside one message: WhatsApp allows about 1,000 characters in all (the draft, 22 Oct 2026). */
const LIST_MAX_CHARS = 600;

/**
 * "a; b; c", cut short with "; and 4 more (we will tell you)" when the whole list would run past what a message can
 * hold (messages 1 and 3). The first item always stays.
 */
export function fitList(items: string[], maxChars = LIST_MAX_CHARS): string {
  const all = items.join("; ");
  if (all.length <= maxChars) return all;
  const more = (n: number) => `; and ${n} more (we will tell you)`;
  const kept = [items[0]!];
  for (const item of items.slice(1)) {
    const next = [...kept, item];
    if (next.join("; ").length + more(items.length - next.length).length > maxChars) break;
    kept.push(item);
  }
  return kept.join("; ") + more(items.length - kept.length);
}

/** One line of an offering's checklist, as message 1 reads it. */
interface ChecklistLine {
  requirement: DocumentRequirement;
  appliesTo: TravellerGroup;
  quantity: number;
  document: { name: string; detail: string | null };
}

/**
 * Message 1's list: what the client brings, each paper once (a checklist names each document once), numbered. Not
 * what we arrange (flights, hotels, insurance), and children's papers only when a child travels.
 * "2. Photos, 35×45 mm, white background × 2 (original)".
 */
export function documentListItems(lines: ChecklistLine[], hasChildren: boolean): string[] {
  return lines
    .filter((l) => l.requirement !== "ARRANGED_BY_US" && (l.appliesTo !== "CHILDREN" || hasChildren))
    .map((l, i) => {
      const what = [l.document.name, l.document.detail].filter(Boolean).join(", ");
      const notes = [l.requirement === "ORIGINAL" ? "original" : null, l.appliesTo === "CHILDREN" ? "for children" : null].filter(Boolean);
      return `${i + 1}. ${what}${l.quantity > 1 ? ` × ${l.quantity}` : ""}${notes.length > 0 ? ` (${notes.join(", ")})` : ""}`;
    });
}
