import type { DocumentRequirement, TravellerGroup, VisaOutcome } from "../../../generated/prisma/enums";
import type { Db } from "../../config/prisma";
import { dayLabel, istToday, timeLabel } from "../../lib/dates";
import { rupeesText } from "../../lib/money";
import { getCompanyDetails } from "../company/company.settings";
import {
  VISA_APPROVED,
  VISA_CREDIT_NOTE,
  VISA_EVISA_PARTLY_APPROVED,
  VISA_EVISA_READY,
  VISA_EVISA_REFUSED,
  VISA_HANDED_OVER,
  VISA_INVOICE,
  VISA_PARTLY_APPROVED,
  VISA_PASSPORTS_BACK,
  VISA_REFUSED,
} from "../messages/messages.seed";
import { queueMessage } from "../messages/messages.service";

// What every visa message says about its case (docs/whatsapp-visa-messages.md): {{client_name}}, {{visa}},
// {{case_no}}, {{travellers}}, {{office_phone}} and {{office_address}}. Each step's message adds its own values to
// these (docs/decisions/0021-whatsapp-outbox.md).

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
  const company = await getCompanyDetails(db);
  return {
    clientId: enquiry.clientId,
    variables: {
      client_name: enquiry.client.name,
      visa: visaLabel(country.name, visaType.name),
      case_no: enquiry.caseNo,
      travellers: travellersText(enquiry.visa._count.travellers),
      office_phone: company.phone,
      // As Settings → Company has it, the invoice's address (the project lead, 22 Oct 2026).
      office_address: company.address,
    },
  };
}

/**
 * Message 7, "Invoice": one for each invoice raised, the main, the additional or a corrected one, in its transaction,
 * with the invoice's PDF (the project lead, 24 Oct 2026: the words say the bank details are on it).
 */
export async function queueInvoiceMessage(tx: Db, enquiryId: string, invoice: { id: string; invoiceNo: string; totalPaise: number; fileId: string }) {
  const basics = await visaMessageBasics(tx, enquiryId);
  await queueMessage(tx, {
    template: VISA_INVOICE,
    enquiryId,
    key: `${VISA_INVOICE}:${invoice.id}`,
    clientId: basics.clientId,
    variables: { ...basics.variables, invoice_no: invoice.invoiceNo, amount: rupeesText(invoice.totalPaise) },
    attachmentId: invoice.fileId,
  });
}

/**
 * Message 18, "Credit note": one for each credit note issued (a wrong invoice cancelled, a recall, a cancelled case's
 * refund), in its transaction, with the credit note's PDF (the project lead, 24 Oct 2026).
 */
export async function queueCreditNoteMessage(
  tx: Db,
  enquiryId: string,
  note: { id: string; creditNoteNo: string; totalPaise: number; invoiceNo: string; fileId: string },
) {
  const basics = await visaMessageBasics(tx, enquiryId);
  await queueMessage(tx, {
    template: VISA_CREDIT_NOTE,
    enquiryId,
    key: `${VISA_CREDIT_NOTE}:${note.id}`,
    clientId: basics.clientId,
    variables: { ...basics.variables, credit_note_no: note.creditNoteNo, amount: rupeesText(note.totalPaise), invoice_no: note.invoiceNo },
    attachmentId: note.fileId,
  });
}

/** "Rakesh Mehta", "Rakesh Mehta and Priya Mehta", "Rakesh Mehta, Priya Mehta and Aarav Mehta". */
export function namesText(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** "1 working day", "2 working days": how long the passports take to reach our office, as messages 10–12 say it. */
export function workingDaysText(days: number): string {
  return `${days} working ${days === 1 ? "day" : "days"}`;
}

/**
 * Messages 10–12, the decision: "Visa approved" when every traveller is, "Visa refused" when every traveller is, else
 * "Partly approved". An e-visa gets 20 or 21 instead, with no passport lines, and nothing when everyone is approved:
 * message 19 brings each e-visa (docs/decisions/0025-evisa-after-decision.md part 5). In the transaction that records
 * it, once per case; a correction later sends nothing. The names are in the case's order, as the decision dialog shows
 * them.
 */
export async function queueDecisionMessage(
  tx: Db,
  enquiryId: string,
  travellers: { name: string; outcome: VisaOutcome }[],
  workingDays: number,
  { evisa = false }: { evisa?: boolean } = {},
) {
  const approved = travellers.filter((t) => t.outcome === "APPROVED").map((t) => t.name);
  const refused = travellers.filter((t) => t.outcome === "REFUSED").map((t) => t.name);
  if (evisa && refused.length === 0) return;
  const allRefused = evisa ? VISA_EVISA_REFUSED : VISA_REFUSED;
  const partly = evisa ? VISA_EVISA_PARTLY_APPROVED : VISA_PARTLY_APPROVED;
  const template = refused.length === 0 ? VISA_APPROVED : approved.length === 0 ? allRefused : partly;
  const basics = await visaMessageBasics(tx, enquiryId);
  await queueMessage(tx, {
    template,
    enquiryId,
    key: `${template}:${enquiryId}`,
    clientId: basics.clientId,
    variables: { ...basics.variables, approved_names: namesText(approved), refused_names: namesText(refused), working_days: workingDaysText(workingDays) },
  });
}

/**
 * Message 13, "Passports at our office": once every booklet that went out is back in our stock (the project lead,
 * 22 Oct 2026). A short return waits for the rest; one that won't come back sends nothing, as staff call. Once per case.
 */
export async function queuePassportsBackMessage(tx: Db, enquiryId: string) {
  const basics = await visaMessageBasics(tx, enquiryId);
  await queueMessage(tx, {
    template: VISA_PASSPORTS_BACK,
    enquiryId,
    key: `${VISA_PASSPORTS_BACK}:${enquiryId}`,
    clientId: basics.clientId,
    variables: basics.variables,
  });
}

/** "2 passports", "4 passports and 3 old passports", "1 old passport": the booklets handed over. */
export function passportCountText(booklets: { current: number; old: number }): string {
  const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  const kinds = [booklets.current > 0 ? count(booklets.current, "passport") : null, booklets.old > 0 ? count(booklets.old, "old passport") : null];
  return kinds.filter(Boolean).join(" and ");
}

/**
 * Message 15, "Passports handed over": at the office or at the door (0015 phase 5), in the handover's transaction, with
 * what was counted, who got them and when ("Sat 31 Oct, 12:10 pm"). Once per case, as its passports go back once.
 */
export async function queueHandoverMessage(tx: Db, enquiryId: string, handover: { booklets: { current: number; old: number }; receiver: string; at: Date }) {
  const basics = await visaMessageBasics(tx, enquiryId);
  await queueMessage(tx, {
    template: VISA_HANDED_OVER,
    enquiryId,
    key: `${VISA_HANDED_OVER}:${enquiryId}`,
    clientId: basics.clientId,
    variables: {
      ...basics.variables,
      passport_count: passportCountText(handover.booklets),
      receiver_name: handover.receiver,
      handover_time: `${dayLabel(istToday(handover.at))}, ${timeLabel(handover.at)}`,
    },
  });
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

/**
 * Message 19, "Your e-visa" (docs/decisions/0025-evisa-after-decision.md, part 3): one approved traveller's e-visa,
 * with its PDF, in the transaction of "Send the e-visa". Once per traveller, as an e-visa is sent once. The e-visa's
 * number and dates aren't in the words: they're optional (0012, amended 23 Oct 2026), and printed on the PDF.
 */
export async function queueEvisaMessage(tx: Db, enquiryId: string, traveller: { id: string; name: string; fileId: string }) {
  const basics = await visaMessageBasics(tx, enquiryId);
  await queueMessage(tx, {
    template: VISA_EVISA_READY,
    enquiryId,
    key: `${VISA_EVISA_READY}:${traveller.id}`,
    clientId: basics.clientId,
    attachmentId: traveller.fileId,
    variables: { ...basics.variables, traveller_name: traveller.name },
  });
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
