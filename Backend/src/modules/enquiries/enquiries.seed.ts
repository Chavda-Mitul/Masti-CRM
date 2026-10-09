import type { Db } from "../../config/prisma";

// Enquiry masters (docs/decisions/0003-visa-intake.md). Used by prisma/seed.ts and the tests.
// Re-seeding never overwrites a row Masti has edited.

/** "Came in through" ⚠️ demo values. The last two are set only by integrations, so staff never pick them. */
export const ENQUIRY_SOURCES = [
  { code: "WHATSAPP", name: "WhatsApp", sortOrder: 1, staffSelectable: true },
  { code: "LANDLINE", name: "Landline", sortOrder: 2, staffSelectable: true },
  { code: "MOBILE", name: "Mobile", sortOrder: 3, staffSelectable: true },
  { code: "SOCIAL_MEDIA", name: "Social media", sortOrder: 4, staffSelectable: true },
  { code: "EMAIL", name: "Email", sortOrder: 5, staffSelectable: true },
  { code: "WEBSITE_FORM", name: "Website form", sortOrder: 6, staffSelectable: false },
  { code: "WHATSAPP_BOT", name: "WhatsApp bot", sortOrder: 7, staffSelectable: false },
];

/** Visa's one flow of steps. Insurance will add INSURANCE_POLICY and INSURANCE_CLAIM (§10.2). */
export const VISA_FLOW = "VISA";

/**
 * The 8 visa steps with the demo's labels ⚠️ (PROJECT_KNOWLEDGE.md §12.4). Step codes are what the code uses.
 * Step 1 says "Enquiry saved", not the demo's "Document list sent": nothing is sent until the WhatsApp outbox is built (0003).
 */
export const VISA_STAGES = [
  { code: "ENQUIRY", name: "Enquiry", statusLabel: "Enquiry saved", nextStepLabel: "Start collecting documents" },
  { code: "DOCUMENTS", name: "Documents", statusLabel: "Documents pending", nextStepLabel: "Mark documents complete" },
  { code: "FILE_PREPARATION", name: "File preparation", statusLabel: "File preparation", nextStepLabel: "File ready — add to docket" },
  { code: "DISPATCH", name: "Docket & dispatch", statusLabel: "Dispatched", nextStepLabel: "Dispatch the docket" },
  { code: "AT_VENDOR", name: "At vendor", statusLabel: "Submitted", nextStepLabel: "Record the decision" },
  { code: "DECISION", name: "Decision", statusLabel: "Approved", nextStepLabel: "Passports on the way back" },
  { code: "PASSPORT_BACK", name: "Passport back", statusLabel: "Passports in our stock", nextStepLabel: "Hand over to the client" },
  { code: "DELIVERED", name: "Delivered", statusLabel: "Delivered", nextStepLabel: "See cross-sell leads" },
];

export async function seedEnquiryMasters(db: Db) {
  for (const source of ENQUIRY_SOURCES) {
    await db.enquirySource.upsert({ where: { code: source.code }, update: {}, create: source });
  }

  const visa = await db.department.findUniqueOrThrow({ where: { code: "VISA" } });
  for (const [i, stage] of VISA_STAGES.entries()) {
    await db.departmentStage.upsert({
      where: { departmentId_flow_code: { departmentId: visa.id, flow: VISA_FLOW, code: stage.code } },
      update: {},
      create: { ...stage, departmentId: visa.id, flow: VISA_FLOW, sortOrder: i + 1 },
    });
  }
}
