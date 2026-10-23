import type { DocumentRequirement, TravellerGroup } from "../../../generated/prisma/enums";
import type { Db } from "../../config/prisma";

// Dummy visa masters (docs/decisions/0005-system-masters.md), replaced when Masti sends the real checklists (inputs B1).
// Used by prisma/seed.ts and the tests. Re-seeding never overwrites an existing row or a checklist that has lines.

export const COUNTRIES = [
  { code: "FR", name: "France", zone: "Schengen", sortOrder: 1 },
  { code: "CN", name: "China", zone: null, sortOrder: 2 },
];

/**
 * Business and Visitor (21 Oct 2026) so their covering letters' AI paragraph gets its own instructions, which go by these
 * codes (docs/decisions/0019-covering-letters.md amendment 2). Like any visa type, a country needs an offering with a
 * checklist (Settings) before intake can use them.
 */
export const VISA_TYPES = [
  { code: "TOURIST", name: "Tourist", sortOrder: 1 },
  { code: "BUSINESS", name: "Business", sortOrder: 2 },
  { code: "VISITOR", name: "Visitor", sortOrder: 3 },
];

export const EMBASSIES = [{ code: "FR-MUM", countryCode: "FR", name: "French embassy, Mumbai", city: "Mumbai", sortOrder: 1 }];

/**
 * The demo's France Tourist list ⚠️, plus the child alternatives (§10.4), plus the Aadhaar and PAN cards the client
 * document vault keeps (docs/decisions/0016-client-documents.md Decision 2). The passport, Aadhaar and PAN start with the
 * "Scan not saved" warning on (Decision 7) ⚠️. Every paper takes a PDF, JPG or PNG up to the shared size limit; the
 * photos' scans must have a 35×45 mm shape (Amendment 1) ⚠️.
 */
export const DOCUMENTS = [
  { code: "PASSPORT", name: "Passport", detail: null, sortOrder: 1, warnIfNoScan: true },
  { code: "OLD_PASSPORTS", name: "Old passports", detail: null, sortOrder: 2 },
  { code: "VISA_FORM", name: "Visa form, signed", detail: null, sortOrder: 3 },
  { code: "PHOTOS", name: "Photos", detail: "35×45 mm, white background", sortOrder: 4, photoWidthMm: 35, photoHeightMm: 45 },
  { code: "BANK_STATEMENT_6M", name: "Bank statement, last 6 months", detail: null, sortOrder: 5 },
  { code: "BIRTH_CERTIFICATE", name: "Birth certificate", detail: null, sortOrder: 6 },
  { code: "ITR_3Y", name: "ITR, last 3 years", detail: null, sortOrder: 7 },
  { code: "SCHOOL_LETTER", name: "School letter", detail: null, sortOrder: 8 },
  { code: "LEAVE_LETTER_NOC", name: "Leave letter / NOC", detail: null, sortOrder: 9 },
  { code: "PARENTS_NOC", name: "Parents' NOC", detail: null, sortOrder: 10 },
  { code: "SALARY_SLIPS_3M", name: "Salary slips, last 3 months", detail: null, sortOrder: 11 },
  { code: "FLIGHT_RESERVATION", name: "Flight reservation", detail: null, sortOrder: 12 },
  { code: "HOTEL_BOOKINGS", name: "Hotel bookings", detail: null, sortOrder: 13 },
  { code: "TRAVEL_INSURANCE", name: "Travel insurance", detail: null, sortOrder: 14 },
  { code: "AADHAAR_CARD", name: "Aadhaar card", detail: null, sortOrder: 15, warnIfNoScan: true },
  { code: "PAN_CARD", name: "PAN card", detail: null, sortOrder: 16, warnIfNoScan: true },
];

/** Why a paper needs replacing (docs/decisions/0007-visa-file-prep.md Decision 3): placeholders ⚠️ until Masti sends its list. */
export const DOCUMENT_PROBLEM_REASONS = [
  { code: "WRONG_PHOTO_SIZE", name: "Wrong photo size", sortOrder: 1 },
  { code: "NOT_SIGNED", name: "Not signed", sortOrder: 2 },
  { code: "EXPIRED", name: "Expired", sortOrder: 3 },
  { code: "COPY_NOT_CLEAR", name: "Copy not clear", sortOrder: 4 },
  { code: "WRONG_DATES", name: "Wrong dates", sortOrder: 5 },
];

/** How fast the embassy processes the application (docs/decisions/0009-visa-invoice.md): placeholders ⚠️ until Masti confirms. */
export const PROCESSING_SPEEDS = [
  { code: "NORMAL", name: "Normal", sortOrder: 1 },
  { code: "EXPRESS", name: "Express", sortOrder: 2 },
  { code: "SUPER_PRIORITY", name: "Super priority", sortOrder: 3 },
];

/**
 * How urgent a visa enquiry is (docs/decisions/0003-visa-intake.md amendment 1): Masti's own two words. NORMAL is where
 * every enquiry starts (NORMAL_URGENCY).
 */
export const URGENCY_LEVELS = [
  { code: "NORMAL", name: "Normal", sortOrder: 1 },
  { code: "URGENT", name: "Urgent", sortOrder: 2 },
];

/** How a docket goes to the vendor (docs/decisions/0008-visa-docket-dispatch.md Decision 6): placeholders ⚠️. */
export const COURIERS = [
  { code: "BLUE_DART", name: "Blue Dart", awbNeeded: true, sortOrder: 1 },
  { code: "DTDC", name: "DTDC", awbNeeded: true, sortOrder: 2 },
  { code: "BY_HAND", name: "By hand (no AWB)", awbNeeded: false, sortOrder: 3 },
];

/** Why a credit note is issued (docs/decisions/0011-visa-at-vendor.md Decision 5): ours, for Masti to approve ⚠️. */
export const CREDIT_NOTE_REASONS = [
  { code: "WRONG_AMOUNT", name: "Wrong amount", sortOrder: 1 },
  { code: "WRONG_CLIENT_DETAILS", name: "Wrong client details", sortOrder: 2 },
  { code: "WRONG_TRAVELLER_DETAILS", name: "Wrong traveller details", sortOrder: 3 },
  { code: "CLIENT_CANCELLED", name: "Client cancelled", sortOrder: 4 },
  { code: "RECALL", name: "Recall", sortOrder: 5 },
];

/** Why a file is taken back from the vendor (docs/decisions/0011-visa-at-vendor.md Decision 6): ours, for Masti ⚠️. */
export const RECALL_REASONS = [
  { code: "EMBASSY_DELAY", name: "Embassy taking too long", sortOrder: 1 },
  { code: "CLIENT_CANCELLED_TRIP", name: "Client cancelled the trip", sortOrder: 2 },
  { code: "DOCUMENTS_CHANGED", name: "Documents changed", sortOrder: 3 },
];

/**
 * Why fewer passports came back than went out, when the shortfall is cleared rather than found
 * (docs/decisions/0013-visa-passport-back.md Decision 5, amended 17 Oct 2026): ours, for Masti ⚠️.
 */
export const MISSING_PASSPORT_REASONS = [
  { code: "EMBASSY_KEPT", name: "Embassy kept it", sortOrder: 1 },
  { code: "VENDOR_HAS_IT", name: "Vendor still has it", sortOrder: 2 },
  { code: "COUNTED_WRONG", name: "Counted wrong at intake", sortOrder: 3 },
  { code: "LOST_REPORTED", name: "Lost, reported to the vendor", sortOrder: 4 },
];

/** What an additional invoice charges for (docs/decisions/0011-visa-at-vendor.md Decision 7): ours, for Masti ⚠️. */
export const EXTRA_CHARGES = [
  { code: "URGENT_SUBMISSION", name: "Urgent submission", sortOrder: 1 },
  { code: "PHOTOS", name: "Photos", sortOrder: 2 },
  { code: "COURIER_EXTRA", name: "Courier, extra", sortOrder: 3 },
];

interface SeedLine {
  code: string;
  requirement: DocumentRequirement;
  appliesTo: TravellerGroup;
  quantity?: number;
}

/** France × Tourist: 11 lines for adults, 10 for children (salary slips are adults-only). Dummy ⚠️. */
export const FRANCE_TOURIST_CHECKLIST: SeedLine[] = [
  { code: "PASSPORT", requirement: "ORIGINAL", appliesTo: "ALL" },
  { code: "OLD_PASSPORTS", requirement: "ORIGINAL", appliesTo: "ALL" },
  { code: "VISA_FORM", requirement: "ORIGINAL", appliesTo: "ALL" },
  { code: "PHOTOS", requirement: "ORIGINAL", appliesTo: "ALL", quantity: 2 },
  { code: "BANK_STATEMENT_6M", requirement: "XEROX_OK", appliesTo: "ADULTS" },
  { code: "BIRTH_CERTIFICATE", requirement: "XEROX_OK", appliesTo: "CHILDREN" },
  { code: "ITR_3Y", requirement: "XEROX_OK", appliesTo: "ADULTS" },
  { code: "SCHOOL_LETTER", requirement: "ORIGINAL", appliesTo: "CHILDREN" },
  { code: "LEAVE_LETTER_NOC", requirement: "ORIGINAL", appliesTo: "ADULTS" },
  { code: "PARENTS_NOC", requirement: "ORIGINAL", appliesTo: "CHILDREN" },
  { code: "SALARY_SLIPS_3M", requirement: "XEROX_OK", appliesTo: "ADULTS" },
  { code: "FLIGHT_RESERVATION", requirement: "ARRANGED_BY_US", appliesTo: "ALL" },
  { code: "HOTEL_BOOKINGS", requirement: "ARRANGED_BY_US", appliesTo: "ALL" },
  { code: "TRAVEL_INSURANCE", requirement: "ARRANGED_BY_US", appliesTo: "ALL" },
];

export async function seedVisaMasters(db: Db) {
  for (const country of COUNTRIES) {
    await db.country.upsert({ where: { code: country.code }, update: {}, create: country });
  }
  for (const type of VISA_TYPES) {
    await db.visaType.upsert({ where: { code: type.code }, update: {}, create: type });
  }
  for (const { countryCode, ...embassy } of EMBASSIES) {
    const country = await db.country.findUniqueOrThrow({ where: { code: countryCode } });
    await db.embassy.upsert({ where: { code: embassy.code }, update: {}, create: { ...embassy, countryId: country.id } });
  }
  for (const document of DOCUMENTS) {
    await db.documentMaster.upsert({ where: { code: document.code }, update: {}, create: document });
  }
  for (const reason of DOCUMENT_PROBLEM_REASONS) {
    await db.documentProblemReason.upsert({ where: { code: reason.code }, update: {}, create: reason });
  }
  for (const speed of PROCESSING_SPEEDS) {
    await db.processingSpeed.upsert({ where: { code: speed.code }, update: {}, create: speed });
  }
  for (const level of URGENCY_LEVELS) {
    await db.urgencyLevel.upsert({ where: { code: level.code }, update: {}, create: level });
  }
  for (const courier of COURIERS) {
    await db.courier.upsert({ where: { code: courier.code }, update: {}, create: courier });
  }
  for (const reason of CREDIT_NOTE_REASONS) {
    await db.creditNoteReason.upsert({ where: { code: reason.code }, update: {}, create: reason });
  }
  for (const reason of RECALL_REASONS) {
    await db.recallReason.upsert({ where: { code: reason.code }, update: {}, create: reason });
  }
  for (const reason of MISSING_PASSPORT_REASONS) {
    await db.missingPassportReason.upsert({ where: { code: reason.code }, update: {}, create: reason });
  }
  for (const charge of EXTRA_CHARGES) {
    await db.extraCharge.upsert({ where: { code: charge.code }, update: {}, create: charge });
  }

  const france = await db.country.findUniqueOrThrow({ where: { code: "FR" } });
  const tourist = await db.visaType.findUniqueOrThrow({ where: { code: "TOURIST" } });
  const offering = await db.visaOffering.upsert({
    where: { countryId_visaTypeId: { countryId: france.id, visaTypeId: tourist.id } },
    update: {},
    create: { countryId: france.id, visaTypeId: tourist.id },
  });
  if ((await db.visaChecklistItem.count({ where: { offeringId: offering.id } })) > 0) return;

  const documents = await db.documentMaster.findMany({ where: { code: { in: FRANCE_TOURIST_CHECKLIST.map((l) => l.code) } } });
  await db.visaChecklistItem.createMany({
    data: FRANCE_TOURIST_CHECKLIST.map((line, i) => ({
      offeringId: offering.id,
      documentId: documents.find((d) => d.code === line.code)!.id,
      requirement: line.requirement,
      appliesTo: line.appliesTo,
      quantity: line.quantity ?? 1,
      sortOrder: i + 1,
    })),
  });
}
