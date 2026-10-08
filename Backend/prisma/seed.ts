/**
 * Seeds the departments and the first Head user.
 *   npm run db:seed
 * Head details come from SEED_HEAD_NAME, SEED_HEAD_MOBILE, SEED_HEAD_EMAIL, SEED_HEAD_PASSWORD (Backend/.env).
 * If no password is given, a temporary one is generated and printed once. Safe to run again.
 * If there is no Head but a user with the SEED_HEAD mobile/email exists, that user is made Head instead.
 */
import "dotenv/config";
import { normaliseEmail, normaliseMobile } from "../src/auth/identifier";
import { generateTempPassword, hashPassword } from "../src/auth/password";
import { DEFAULT_OFFICE_NETWORK, OFFICE_NETWORK_KEY } from "../src/auth/officeNetwork";
import { prisma } from "../src/config/prisma";
import { audit } from "../src/lib/audit";

const DEPARTMENTS = [
  { code: "VISA", name: "Visa", sortOrder: 1 },
  { code: "HOLIDAYS", name: "Holidays", sortOrder: 2 },
  { code: "HOTELS", name: "Hotels", sortOrder: 3 },
  { code: "INSURANCE", name: "Insurance", sortOrder: 4 },
  { code: "TICKETS", name: "Tickets", sortOrder: 5 },
  { code: "ACCOUNTS", name: "Accounts", sortOrder: 6 },
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

  if (await prisma.user.findFirst({ where: { type: "HEAD" } })) {
    console.log("A Head user already exists. Skipping.");
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
    console.log(`No Head user found. ${existing.name} (${[mobile, email].filter(Boolean).join(" / ")}) is now Head.`);
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
