import type { Db } from "../../config/prisma";

// The automatic messages' wording (docs/decisions/0021-whatsapp-outbox.md), word for word from the draft Masti is to
// approve (docs/whatsapp-visa-messages.md, M1). Used by prisma/seed.ts and the tests. Re-seeding never overwrites a
// wording that has been changed.

/** Message 6: staff mark the documents complete and hand the case to the visa team. */
export const VISA_DOCUMENTS_RECEIVED = "visa.documents_received";

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
];

export async function seedMessageTemplates(db: Db) {
  for (const template of MESSAGE_TEMPLATES) {
    await db.messageTemplate.upsert({ where: { code: template.code }, update: {}, create: template });
  }
}
