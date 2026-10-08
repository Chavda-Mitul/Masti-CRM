import type { Db } from "../../config/prisma";

// Seed rows for the client lookup tables. Used by prisma/seed.ts and the tests.
// They are masters (admin-editable once System Masters is built), so re-seeding never overwrites an existing row.

export const BILLING_CYCLES = [
  { code: "WEEKLY", name: "Weekly", sortOrder: 1, isDefault: false },
  { code: "HALF_MONTHLY", name: "Half-monthly", sortOrder: 2, isDefault: false },
  // Default monthly ✅
  { code: "MONTHLY", name: "Monthly", sortOrder: 3, isDefault: true },
];

/** ⚠️ Only "Part advance, rest on delivery" comes from the demo; the rest are our guesses. */
export const PAYMENT_HABITS = [
  { code: "FULL_ADVANCE", name: "Full advance", sortOrder: 1 },
  { code: "PART_ADVANCE", name: "Part advance, rest on delivery", sortOrder: 2 },
  { code: "ON_DELIVERY", name: "On delivery", sortOrder: 3 },
  { code: "ON_CREDIT", name: "On credit (billing cycle)", sortOrder: 4 },
];

export const RELATIONS = [
  { code: "SELF", name: "Self", sortOrder: 1 },
  { code: "SPOUSE", name: "Spouse", sortOrder: 2 },
  { code: "SON", name: "Son", sortOrder: 3 },
  { code: "DAUGHTER", name: "Daughter", sortOrder: 4 },
  { code: "FATHER", name: "Father", sortOrder: 5 },
  { code: "MOTHER", name: "Mother", sortOrder: 6 },
  { code: "BROTHER", name: "Brother", sortOrder: 7 },
  { code: "SISTER", name: "Sister", sortOrder: 8 },
  { code: "GRANDPARENT", name: "Grandparent", sortOrder: 9 },
  { code: "EMPLOYEE", name: "Employee", sortOrder: 10 },
  { code: "OTHER", name: "Other", sortOrder: 11 },
];

export async function seedClientLookups(db: Db) {
  // A default is only set when there is none yet (the database allows one).
  const hasDefault = (await db.billingCycle.count({ where: { isDefault: true } })) > 0;
  for (const cycle of BILLING_CYCLES) {
    await db.billingCycle.upsert({
      where: { code: cycle.code },
      update: {},
      create: { ...cycle, isDefault: cycle.isDefault && !hasDefault },
    });
  }
  for (const habit of PAYMENT_HABITS) {
    await db.paymentHabit.upsert({ where: { code: habit.code }, update: {}, create: habit });
  }
  for (const relation of RELATIONS) {
    await db.relation.upsert({ where: { code: relation.code }, update: {}, create: relation });
  }
}
