import type { Db } from "../../config/prisma";

// The automatic messages' wording (docs/decisions/0021-whatsapp-outbox.md), word for word from the draft Masti is to
// approve (docs/whatsapp-visa-messages.md, M1). Used by prisma/seed.ts and the tests. Re-seeding never overwrites a
// wording that has been changed.

/** Message 6: staff mark the documents complete and hand the case to the visa team. */
export const VISA_DOCUMENTS_RECEIVED = "visa.documents_received";

/**
 * Message 4: staff save a traveller's consent details and that person hasn't agreed yet (docs/decisions/0022-consent-form.md).
 * The draft's "Before we apply" is gone: consent never holds up the case.
 */
export const VISA_CONSENT_LINK = "visa.consent_link";

/** Message 1: staff save a new visa case; what the client brings. */
export const VISA_DOCUMENT_LIST = "visa.document_list";

/** Message 2: the case's price is saved for the first time. */
export const VISA_PRICE = "visa.price";

/** Message 3: the reminder, every few days at a set time, while papers are missing (0006 amendment 19). */
export const VISA_DOCUMENT_REMINDER = "visa.document_reminder";

/** Message 5: the collection boy is booked, or the visit changes. A suggestion beyond the demo (change request 12). */
export const VISA_COLLECTION_VISIT = "visa.collection_visit";

/** Message 7: an invoice is raised (the main, the additional or a corrected one). Words only for now: no PDF. */
export const VISA_INVOICE = "visa.invoice";

/** Message 8: the file is first marked submitted at the embassy (Step 5). */
export const VISA_SUBMITTED = "visa.submitted";

/** Message 9: an e-visa is marked applied online (Step 4). */
export const VISA_APPLIED_ONLINE = "visa.applied_online";

export const MESSAGE_TEMPLATES = [
  {
    code: VISA_DOCUMENTS_RECEIVED,
    name: "All documents received",
    body: [
      "Dear {{client_name}},",
      "",
      "Thank you! We have received all documents for your {{visa}} ({{case_no}}). Our visa team is now preparing your file, and we will update you at every step.",
      "",
      "– Masti Tours & Travels",
    ].join("\n"),
  },
  {
    code: VISA_CONSENT_LINK,
    name: "Consent form (I agree)",
    body: [
      "Dear {{recipient_name}},",
      "",
      'For the {{visa}} ({{case_no}}), please read the consent and liability form for {{traveller_name}} and tap "I agree":',
      "{{consent_link}}",
      "",
      "For any question, call us on {{office_phone}}.",
      "",
      "– Masti Tours & Travels",
    ].join("\n"),
  },
  {
    code: VISA_DOCUMENT_LIST,
    name: "Document list",
    body: [
      "Dear {{client_name}},",
      "",
      "Thank you for choosing Masti Tours & Travels for your {{visa}}. Your case number is {{case_no}}.",
      "",
      "Documents needed for {{travellers}}: {{document_list}}",
      "",
      "Our staff can collect them from your home, or you can bring them to our office. For any question, call us on {{office_phone}}.",
      "",
      "– Masti Tours & Travels",
    ].join("\n"),
  },
  {
    code: VISA_PRICE,
    name: "Your price",
    body: [
      "Dear {{client_name}},",
      "",
      "The price for your {{visa}} ({{case_no}}) is ₹{{total}} for {{travellers}}, including all fees and taxes.",
      "",
      "For any question, call us on {{office_phone}}.",
      "",
      "– Masti Tours & Travels",
    ].join("\n"),
  },
  {
    code: VISA_DOCUMENT_REMINDER,
    name: "Documents still pending",
    body: [
      "Dear {{client_name}},",
      "",
      "A reminder for your {{visa}} ({{case_no}}). We are still waiting for: {{pending_list}}.",
      "",
      "Our staff can come to your home to collect them. Call us on {{office_phone}} to book a time.",
      "",
      "– Masti Tours & Travels",
    ].join("\n"),
  },
  {
    code: VISA_COLLECTION_VISIT,
    name: "Collection visit booked",
    body: [
      "Dear {{client_name}},",
      "",
      "Our staff member {{staff_name}} will come to collect the documents for {{case_no}} on {{visit_day}}, {{visit_slot}}, at: {{address}}.",
      "",
      "Please keep the documents and your phone ready. We will send you a code to tell our staff member at the door.",
      "",
      "To change the time, call us on {{office_phone}}.",
      "",
      "– Masti Tours & Travels",
    ].join("\n"),
  },
  {
    code: VISA_INVOICE,
    name: "Invoice",
    body: [
      "Dear {{client_name}},",
      "",
      "Your invoice {{invoice_no}} for the {{visa}} ({{case_no}}) is ready. Amount: ₹{{amount}}.",
      "",
      "You can pay by bank transfer or at our office. Our bank details are on the invoice.",
      "",
      "– Masti Tours & Travels",
    ].join("\n"),
  },
  {
    code: VISA_SUBMITTED,
    name: "File submitted",
    body: [
      "Dear {{client_name}},",
      "",
      "Your {{visa}} file ({{case_no}}) has been submitted to the {{embassy}}.",
      "",
      "We expect the result around {{expected_date}} and will message you as soon as we hear.",
      "",
      "– Masti Tours & Travels",
    ].join("\n"),
  },
  {
    code: VISA_APPLIED_ONLINE,
    name: "Applied online",
    body: [
      "Dear {{client_name}},",
      "",
      "We have applied online for your {{visa}} ({{case_no}}). We will message you as soon as the result comes.",
      "",
      "– Masti Tours & Travels",
    ].join("\n"),
  },
];

export async function seedMessageTemplates(db: Db) {
  for (const template of MESSAGE_TEMPLATES) {
    await db.messageTemplate.upsert({ where: { code: template.code }, update: {}, create: template });
  }
}
