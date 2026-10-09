/**
 * Seeds the departments, the client lookup tables and settings, the system masters (dummy visa masters, the weekly
 * Sunday off, holiday settings), the enquiry sources and visa steps, and the first Head user.
 *   npm run db:seed
 * Head details come from SEED_HEAD_NAME, SEED_HEAD_MOBILE, SEED_HEAD_EMAIL, SEED_HEAD_PASSWORD (Backend/.env).
 * If no password is given, a temporary one is generated and printed once. Safe to run again.
 * If there is no active Head but a user with the SEED_HEAD mobile/email exists, that user is made (and reactivated as) Head instead.
 */
import "dotenv/config";
import { normaliseEmail, normaliseMobile } from "../src/lib/contact";
import { generateTempPassword, hashPassword } from "../src/modules/auth/password";
import { DEFAULT_OFFICE_NETWORK, OFFICE_NETWORK_KEY } from "../src/modules/auth/officeNetwork";
import { seedClientLookups } from "../src/modules/clients/clients.seed";
import { seedHolidays } from "../src/modules/holidays/holidays.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { DEFAULT_FIRST_FOLLOW_UP, FIRST_FOLLOW_UP_KEY } from "../src/modules/visa/visa.settings";
import {
  DEFAULT_EXPIRY_WARNINGS,
  DEFAULT_INVOICE_READINESS,
  EXPIRY_WARNINGS_KEY,
  INVOICE_READINESS_KEY,
} from "../src/modules/clients/clients.settings";
import { prisma } from "../src/config/prisma";
import { audit } from "../src/lib/audit";

const DEPARTMENTS = [
  { code: "VISA", name: "Visa", casePrefix: "VISA", sortOrder: 1 },
  { code: "HOLIDAYS", name: "Holidays", casePrefix: "HOL", sortOrder: 2 },
  { code: "HOTELS", name: "Hotels", casePrefix: "HOT", sortOrder: 3 },
  { code: "INSURANCE", name: "Insurance", casePrefix: "INS", sortOrder: 4 },
  { code: "TICKETS", name: "Tickets", casePrefix: "TKT", sortOrder: 5 },
  { code: "ACCOUNTS", name: "Accounts", casePrefix: "ACC", sortOrder: 6 },
];

async function main() {
  for (const d of DEPARTMENTS) {
    await prisma.department.upsert({ where: { code: d.code }, update: { name: d.name, sortOrder: d.sortOrder }, create: d });
  }
  console.log(`Departments ready: ${DEPARTMENTS.map((d) => d.code).join(", ")}`);

  await prisma.setting.upsert({
    where: { key: OFFICE_NETWORK_KEY },
    update: {},
    create: { key: OFFICE_NETWORK_KEY, value: DEFAULT_OFFICE_NETWORK },
  });

  // Client master: lookup tables and the ⚠️ settings (docs/decisions/0004-client-master.md). Existing rows are kept.
  await seedClientLookups(prisma);
  for (const [key, value] of [
    [INVOICE_READINESS_KEY, DEFAULT_INVOICE_READINESS],
    [EXPIRY_WARNINGS_KEY, DEFAULT_EXPIRY_WARNINGS],
  ] as const) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value } });
  }
  console.log("Client lookups and settings ready.");

  // System masters (docs/decisions/0005-system-masters.md): dummy until Masti sends B1/B2. Existing rows are kept.
  await seedVisaMasters(prisma);
  await seedHolidays(prisma);
  console.log("Visa masters (France Tourist dummy), the weekly Sunday off and holiday settings ready.");

  // Visa intake (docs/decisions/0003-visa-intake.md): sources, the 8 visa steps and the follow-up timing ⚠️.
  await seedEnquiryMasters(prisma);
  await prisma.setting.upsert({
    where: { key: FIRST_FOLLOW_UP_KEY },
    update: {},
    create: { key: FIRST_FOLLOW_UP_KEY, value: DEFAULT_FIRST_FOLLOW_UP },
  });
  console.log("Enquiry sources, visa steps and visa follow-up timing ready.");

  // An inactive Head doesn't count: if every Head was deactivated, the seed is how Masti gets back in.
  if (await prisma.user.findFirst({ where: { type: "HEAD", isActive: true } })) {
    console.log("An active Head user already exists. Skipping.");
    return;
  }

  const name = process.env.SEED_HEAD_NAME?.trim() || "Vimal";
  const mobile = process.env.SEED_HEAD_MOBILE ? normaliseMobile(process.env.SEED_HEAD_MOBILE) : null;
  const email = process.env.SEED_HEAD_EMAIL ? normaliseEmail(process.env.SEED_HEAD_EMAIL) : null;
  if (process.env.SEED_HEAD_MOBILE && !mobile) throw new Error("SEED_HEAD_MOBILE is not a valid Indian mobile number.");
  if (!mobile && !email) throw new Error("Set SEED_HEAD_MOBILE and/or SEED_HEAD_EMAIL in Backend/.env to create the first Head user.");

  const existing = await prisma.user.findFirst({ where: { OR: [...(mobile ? [{ mobile }] : []), ...(email ? [{ email }] : [])] } });
  if (existing) {
    await prisma.$transaction(async (tx) => {
      // Department rows first: the database refuses a Head with department roles.
      await tx.userDepartment.deleteMany({ where: { userId: existing.id } });
      await tx.user.update({ where: { id: existing.id }, data: { type: "HEAD", isActive: true } });
      await audit(
        {
          action: "user.update",
          entityType: "User",
          entityId: existing.id,
          before: { type: existing.type, isActive: existing.isActive },
          after: { type: "HEAD", isActive: true, via: "seed" },
        },
        tx,
      );
    });
    console.log(`No active Head user found. ${existing.name} (${[mobile, email].filter(Boolean).join(" / ")}) is now Head.`);
    return;
  }

  const givenPassword = process.env.SEED_HEAD_PASSWORD;
  const password = givenPassword || generateTempPassword();
  const head = await prisma.user.create({
    data: { name, mobile, email, type: "HEAD", passwordHash: await hashPassword(password), mustChangePassword: true },
  });
  await audit({ action: "user.create", entityType: "User", entityId: head.id, after: { name, mobile, email, type: "HEAD", via: "seed" } });

  console.log(`Head user created: ${name} (${[mobile, email].filter(Boolean).join(" / ")})`);
  if (!givenPassword) console.log(`Temporary password (shown once, must be changed at first login): ${password}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
