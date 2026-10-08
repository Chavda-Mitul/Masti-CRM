-- CreateEnum
CREATE TYPE "ClientKind" AS ENUM ('INDIVIDUAL', 'CORPORATE');

-- CreateTable
CREATE TABLE "BillingCycle" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BillingCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentHabit" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PaymentHabit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Relation" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Relation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "kind" "ClientKind" NOT NULL DEFAULT 'INDIVIDUAL',
    "mobile" TEXT NOT NULL,
    "name" TEXT,
    "contactPerson" TEXT,
    "email" TEXT,
    "addressLine" TEXT,
    "area" TEXT,
    "city" TEXT,
    "stateCode" CHAR(2),
    "pincode" CHAR(6),
    "pan" TEXT,
    "gstin" TEXT,
    "accountingCode" TEXT,
    "billingCycleId" INTEGER NOT NULL,
    "paymentHabitId" INTEGER,
    "clientSince" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientPhone" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "ClientPhone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientMember" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationId" INTEGER NOT NULL,
    "dateOfBirth" DATE,
    "mobile" TEXT,
    "passportNumber" TEXT,
    "passportExpiry" DATE,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "ClientMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientNote" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillingCycle_code_key" ON "BillingCycle"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentHabit_code_key" ON "PaymentHabit"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Relation_code_key" ON "Relation"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Client_mobile_key" ON "Client"("mobile");

-- CreateIndex
CREATE UNIQUE INDEX "Client_accountingCode_key" ON "Client"("accountingCode");

-- CreateIndex
CREATE INDEX "Client_name_idx" ON "Client"("name");

-- CreateIndex
CREATE INDEX "Client_pan_idx" ON "Client"("pan");

-- CreateIndex
CREATE INDEX "Client_gstin_idx" ON "Client"("gstin");

-- CreateIndex
CREATE INDEX "ClientPhone_mobile_idx" ON "ClientPhone"("mobile");

-- CreateIndex
CREATE UNIQUE INDEX "ClientPhone_clientId_mobile_key" ON "ClientPhone"("clientId", "mobile");

-- CreateIndex
CREATE INDEX "ClientMember_clientId_idx" ON "ClientMember"("clientId");

-- CreateIndex
CREATE INDEX "ClientMember_passportNumber_idx" ON "ClientMember"("passportNumber");

-- CreateIndex
CREATE INDEX "ClientNote_clientId_createdAt_idx" ON "ClientNote"("clientId", "createdAt");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_billingCycleId_fkey" FOREIGN KEY ("billingCycleId") REFERENCES "BillingCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_paymentHabitId_fkey" FOREIGN KEY ("paymentHabitId") REFERENCES "PaymentHabit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPhone" ADD CONSTRAINT "ClientPhone_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientPhone" ADD CONSTRAINT "ClientPhone_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientMember" ADD CONSTRAINT "ClientMember_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientMember" ADD CONSTRAINT "ClientMember_relationId_fkey" FOREIGN KEY ("relationId") REFERENCES "Relation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientMember" ADD CONSTRAINT "ClientMember_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientNote" ADD CONSTRAINT "ClientNote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientNote" ADD CONSTRAINT "ClientNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written integrity rules (Prisma can't express these). See docs/decisions/0004-client-master.md.
-- The service validates the same rules with friendlier messages; these also guard the Excel import and other writers.
-- ---------------------------------------------------------------------------

-- At most one default billing cycle.
CREATE UNIQUE INDEX "BillingCycle_one_default" ON "BillingCycle" ("isDefault") WHERE "isDefault";

-- Mobiles are stored normalised, like User.mobile.
ALTER TABLE "Client" ADD CONSTRAINT "Client_mobile_format" CHECK ("mobile" ~ '^\+91[6-9][0-9]{9}$');
ALTER TABLE "ClientPhone" ADD CONSTRAINT "ClientPhone_mobile_format" CHECK ("mobile" ~ '^\+91[6-9][0-9]{9}$');
ALTER TABLE "ClientMember" ADD CONSTRAINT "ClientMember_mobile_format" CHECK ("mobile" IS NULL OR "mobile" ~ '^\+91[6-9][0-9]{9}$');

-- Only companies have a contact person.
ALTER TABLE "Client" ADD CONSTRAINT "Client_contact_person_corporate_only" CHECK ("kind" = 'CORPORATE' OR "contactPerson" IS NULL);

-- PAN and GSTIN are stored uppercase, and a GSTIN carries its holder's PAN in characters 3–12.
ALTER TABLE "Client" ADD CONSTRAINT "Client_pan_format" CHECK ("pan" IS NULL OR "pan" ~ '^[A-Z]{5}[0-9]{4}[A-Z]$');
ALTER TABLE "Client" ADD CONSTRAINT "Client_gstin_format" CHECK ("gstin" IS NULL OR "gstin" ~ '^[0-9]{2}[A-Z0-9]{13}$');
ALTER TABLE "Client" ADD CONSTRAINT "Client_gstin_matches_pan" CHECK ("gstin" IS NULL OR "pan" IS NULL OR substring("gstin" FROM 3 FOR 10) = "pan");

-- Passport numbers are stored uppercase with no spaces.
ALTER TABLE "ClientMember" ADD CONSTRAINT "ClientMember_passport_format" CHECK ("passportNumber" IS NULL OR "passportNumber" ~ '^[A-Z0-9]{6,12}$');
