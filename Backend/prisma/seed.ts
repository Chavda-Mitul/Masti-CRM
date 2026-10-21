/**
 * Seeds the departments, the client lookup tables and settings, the system masters (dummy visa masters, the weekly
 * Sunday off, holiday settings, sample covering letters), the enquiry sources and visa steps, the Today page's setting,
 * and the first Head user.
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
import { seedCoveringLetters } from "../src/modules/coveringLetters/coveringLetters.seed";
import { seedHolidays } from "../src/modules/holidays/holidays.seed";
import { seedVisaMasters } from "../src/modules/visaMasters/visaMasters.seed";
import { seedEnquiryMasters } from "../src/modules/enquiries/enquiries.seed";
import { seedMessageTemplates } from "../src/modules/messages/messages.seed";
import { seedConsentWording } from "../src/modules/consent/consent.seed";
import {
  AWB_KEY,
  DEFAULT_AWB,
  DEFAULT_DOCKET,
  DEFAULT_DOCKET_EMAIL,
  DEFAULT_DOCUMENT_REMINDERS,
  DEFAULT_FIRST_FOLLOW_UP,
  DEFAULT_INVOICE,
  DEFAULT_CREDIT_NOTE,
  DEFAULT_ONLINE_CHECK,
  DEFAULT_STICKER,
  DEFAULT_SUBMISSION_CHECK,
  DEFAULT_RECALL_RETURN,
  DEFAULT_PASSPORTS_BACK_CHECK,
  DEFAULT_ARRIVAL_CHECK,
  DEFAULT_HANDOVER_CHECK,
  DEFAULT_HANDOVER_PHOTO,
  DEFAULT_COLLECTION_CHECK,
  DEFAULT_PASSPORT_VALIDITY,
  DEFAULT_CHILD_AGE,
  DEFAULT_COVERING_LETTER,
  DEFAULT_VENDOR_CONFIRM,
  DOCKET_EMAIL_KEY,
  DOCUMENT_REMINDERS_KEY,
  DOCKET_KEY,
  FIRST_FOLLOW_UP_KEY,
  INVOICE_KEY,
  CREDIT_NOTE_KEY,
  ONLINE_CHECK_KEY,
  STICKER_KEY,
  SUBMISSION_CHECK_KEY,
  RECALL_RETURN_KEY,
  PASSPORTS_BACK_CHECK_KEY,
  ARRIVAL_CHECK_KEY,
  ASSIGN_CHECK_KEY,
  DEFAULT_ASSIGN_CHECK,
  DISPATCH_CHECK_KEY,
  DEFAULT_DISPATCH_CHECK,
  HANDOVER_CHECK_KEY,
  HANDOVER_PHOTO_KEY,
  COLLECTION_CHECK_KEY,
  PASSPORT_VALIDITY_KEY,
  CHILD_AGE_KEY,
  COVERING_LETTER_KEY,
  VENDOR_CONFIRM_KEY,
} from "../src/modules/visa/visa.settings";
import { COMPANY_DETAILS_KEY, DEFAULT_COMPANY_DETAILS, DEFAULT_INVOICE_TERMS, INVOICE_TERMS_KEY } from "../src/modules/company/company.settings";
import {
  CLIENT_DOCUMENTS_KEY,
  DEFAULT_CLIENT_DOCUMENTS,
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

  // Client master: lookup tables and the ⚠️ settings (docs/decisions/0004-client-master.md), with the document vault's
  // largest scan (docs/decisions/0016-client-documents.md). Existing rows are kept.
  await seedClientLookups(prisma);
  for (const [key, value] of [
    [INVOICE_READINESS_KEY, DEFAULT_INVOICE_READINESS],
    [EXPIRY_WARNINGS_KEY, DEFAULT_EXPIRY_WARNINGS],
    [CLIENT_DOCUMENTS_KEY, DEFAULT_CLIENT_DOCUMENTS],
  ] as const) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value } });
  }
  console.log("Client lookups and settings ready.");

  // System masters (docs/decisions/0005-system-masters.md): dummy until Masti sends B1/B2. Existing rows are kept.
  await seedVisaMasters(prisma);
  await seedHolidays(prisma);
  // Sample covering letters (docs/decisions/0019-covering-letters.md, amendment 2) until Masti's own replace them: only
  // into a database with none.
  await seedCoveringLetters(prisma);
  console.log(
    "Visa masters (France Tourist dummy; Business and Visitor visa types, which need an offering and a checklist before intake can use them), document problem reasons, processing speeds, the weekly Sunday off, holiday settings and sample covering letters ready.",
  );

  // Visa intake (docs/decisions/0003-visa-intake.md): sources, the 8 visa steps and the follow-up timing ⚠️.
  await seedEnquiryMasters(prisma);
  // The automatic WhatsApp wording (docs/decisions/0021-whatsapp-outbox.md), from the draft Masti is to approve (M1).
  await seedMessageTemplates(prisma);
  // The consent form's draft wording (docs/decisions/0022-consent-form.md), until Masti's (Q9): only into an empty table.
  await seedConsentWording(prisma);
  await prisma.setting.upsert({
    where: { key: FIRST_FOLLOW_UP_KEY },
    update: {},
    create: { key: FIRST_FOLLOW_UP_KEY, value: DEFAULT_FIRST_FOLLOW_UP },
  });
  // Docket numbers and the parcel sticker's size (docs/decisions/0008-visa-docket-dispatch.md Decisions 5 and 7) ⚠️, the
  // invoice series and GST rate (docs/decisions/0009-visa-invoice.md) ⚠️, the vendor-confirm timing and slip-number
  // lengths (0008 Decisions 6 and 9) ⚠️, the e-visa portal check (0008 Decision 11) ⚠️, the vendor email's wording
  // (0008 Decision 8) ⚠️, the file-number check (0011 Decision 2) ⚠️, the collection reminder (0011
  // Decision 4) ⚠️, the credit-note series (0011 Decision 5) ⚠️, the recall's
  // follow-up (0011 Decision 6) ⚠️, the check after the decision (0012 Decision 7) ⚠️, the check on the day passports are expected back (0013
  // Decision 3) ⚠️, when a matured case is due to be assigned (0006, amended 16 Oct 2026) ⚠️, the handover check once
  // the passports are received (0013 Decision 5) ⚠️, the receiver photo's size limit (0014 Decision 6) ⚠️, the covering
  // letter's letterhead space (0019 Decision 11) ⚠️, and Masti's own details.
  for (const [key, value] of [
    [DOCKET_KEY, DEFAULT_DOCKET],
    [STICKER_KEY, DEFAULT_STICKER],
    [INVOICE_KEY, DEFAULT_INVOICE],
    [CREDIT_NOTE_KEY, DEFAULT_CREDIT_NOTE],
    [VENDOR_CONFIRM_KEY, DEFAULT_VENDOR_CONFIRM],
    [ONLINE_CHECK_KEY, DEFAULT_ONLINE_CHECK],
    [SUBMISSION_CHECK_KEY, DEFAULT_SUBMISSION_CHECK],
    [RECALL_RETURN_KEY, DEFAULT_RECALL_RETURN],
    [PASSPORTS_BACK_CHECK_KEY, DEFAULT_PASSPORTS_BACK_CHECK],
    [ARRIVAL_CHECK_KEY, DEFAULT_ARRIVAL_CHECK],
    [ASSIGN_CHECK_KEY, DEFAULT_ASSIGN_CHECK],
    [DISPATCH_CHECK_KEY, DEFAULT_DISPATCH_CHECK],
    [HANDOVER_CHECK_KEY, DEFAULT_HANDOVER_CHECK],
    [HANDOVER_PHOTO_KEY, DEFAULT_HANDOVER_PHOTO],
    [COLLECTION_CHECK_KEY, DEFAULT_COLLECTION_CHECK],
    [PASSPORT_VALIDITY_KEY, DEFAULT_PASSPORT_VALIDITY],
    [CHILD_AGE_KEY, DEFAULT_CHILD_AGE],
    [COVERING_LETTER_KEY, DEFAULT_COVERING_LETTER],
    [AWB_KEY, DEFAULT_AWB],
    [DOCKET_EMAIL_KEY, DEFAULT_DOCKET_EMAIL],
    [DOCUMENT_REMINDERS_KEY, DEFAULT_DOCUMENT_REMINDERS],
    [COMPANY_DETAILS_KEY, DEFAULT_COMPANY_DETAILS],
    [INVOICE_TERMS_KEY, DEFAULT_INVOICE_TERMS],
  ] as const) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value } });
  }
  console.log(
    "Enquiry sources, visa steps, follow-up and reason dropdowns, visa follow-up timing, the docket prefix, the sticker size, the invoice series and GST rate, the vendor email's wording, the covering letter's letterhead space, the company details and the invoice terms ready.",
  );

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
