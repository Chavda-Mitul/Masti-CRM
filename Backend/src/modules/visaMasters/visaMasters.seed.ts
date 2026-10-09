import type { DocumentRequirement, TravellerGroup } from "../../../generated/prisma/enums";
import type { Db } from "../../config/prisma";

// Dummy visa masters (docs/decisions/0005-system-masters.md), replaced when Masti sends the real checklists (inputs B1).
// Used by prisma/seed.ts and the tests. Re-seeding never overwrites an existing row or a checklist that has lines.

export const COUNTRIES = [
  { code: "FR", name: "France", zone: "Schengen", sortOrder: 1 },
  { code: "CN", name: "China", zone: null, sortOrder: 2 },
];

export const VISA_TYPES = [{ code: "TOURIST", name: "Tourist", sortOrder: 1 }];

export const EMBASSIES = [{ code: "FR-MUM", countryCode: "FR", name: "French embassy, Mumbai", city: "Mumbai", sortOrder: 1 }];

/** The demo's France Tourist list ⚠️, plus the child alternatives (§10.4). */
export const DOCUMENTS = [
  { code: "PASSPORT", name: "Passport", detail: null, sortOrder: 1 },
  { code: "OLD_PASSPORTS", name: "Old passports", detail: null, sortOrder: 2 },
  { code: "VISA_FORM", name: "Visa form, signed", detail: null, sortOrder: 3 },
  { code: "PHOTOS", name: "Photos", detail: "35×45 mm, white background", sortOrder: 4 },
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
