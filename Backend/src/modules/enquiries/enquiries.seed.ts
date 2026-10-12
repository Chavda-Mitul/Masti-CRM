import type { Db } from "../../config/prisma";

// Enquiry masters (docs/decisions/0003-visa-intake.md, 0006-visa-documents.md). Used by prisma/seed.ts and the tests.
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

/** Follow-up "What happened" ⚠️ demo values (PROJECT_KNOWLEDGE.md §10.3, docs/decisions/0006-visa-documents.md). */
export const FOLLOW_UP_OUTCOMES = [
  { code: "SPOKE_DOCS_COMING", name: "Spoke — documents coming", sortOrder: 1 },
  { code: "NO_ANSWER", name: "No answer", sortOrder: 2 },
  { code: "CALL_LATER", name: "Asked to call later", sortOrder: 3 },
  { code: "WANTS_POSTPONE", name: "Wants to postpone", sortOrder: 4 },
  { code: "WANTS_CANCEL", name: "Wants to cancel", sortOrder: 5 },
  { code: "DOCS_COMPLETE", name: "Documents complete", sortOrder: 6 },
];

/** Follow-up "Next step" ⚠️ demo values. */
export const FOLLOW_UP_NEXT_STEPS = [
  { code: "SEND_COLLECTION_BOY", name: "Send collection boy", sortOrder: 1 },
  { code: "CLIENT_VISITS_OFFICE", name: "Client will visit office", sortOrder: 2 },
  { code: "CALL_AGAIN", name: "Call again", sortOrder: 3 },
];

/** Postpone and cancel reasons ⚠️ demo values (§12.4 Step 2 and §12.20). */
export const ENQUIRY_REASONS = [
  { kind: "POSTPONE", code: "TRAVEL_DATES_MOVED", name: "Travel dates moved", sortOrder: 1 },
  { kind: "POSTPONE", code: "WAITING_LEAVE_APPROVAL", name: "Waiting for leave approval", sortOrder: 2 },
  { kind: "CANCEL", code: "WENT_WITH_ANOTHER_AGENT", name: "Went with another agent", sortOrder: 3 },
  { kind: "CANCEL", code: "TRIP_CANCELLED", name: "Trip cancelled", sortOrder: 4 },
  { kind: "CANCEL", code: "PRICE_HIGHER", name: "Price higher", sortOrder: 5 },
  { kind: "CANCEL", code: "VISA_NOT_NEEDED", name: "Visa not needed", sortOrder: 6 },
  { kind: "CANCEL", code: "DOCUMENTS_NOT_AVAILABLE", name: "Documents not available", sortOrder: 7 },
  { kind: "CANCEL", code: "NO_REPLY", name: "No reply", sortOrder: 8 },
] as const;

export async function seedEnquiryMasters(db: Db) {
  for (const source of ENQUIRY_SOURCES) {
    await db.enquirySource.upsert({ where: { code: source.code }, update: {}, create: source });
  }
  for (const outcome of FOLLOW_UP_OUTCOMES) {
    await db.followUpOutcome.upsert({ where: { code: outcome.code }, update: {}, create: outcome });
  }
  for (const step of FOLLOW_UP_NEXT_STEPS) {
    await db.followUpNextStep.upsert({ where: { code: step.code }, update: {}, create: step });
  }
  for (const reason of ENQUIRY_REASONS) {
    await db.enquiryReason.upsert({ where: { code: reason.code }, update: {}, create: reason });
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
