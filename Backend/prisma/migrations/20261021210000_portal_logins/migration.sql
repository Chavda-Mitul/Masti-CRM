-- Portal logins, "Log in for me" (docs/decisions/0024-portal-logins.md, demo screen 28): company accounts on visa,
-- airline and supplier portals. The ID and password are sealed under PORTAL_VAULT_KEY (src/lib/secretBox.ts); staff press
-- "Log in for me" and the CRM helper types them into the portal. Every press is kept.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)
-- CreateEnum
CREATE TYPE "PortalLoginStatus" AS ENUM ('ACTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "PortalLoginOutcome" AS ENUM ('SUBMITTED', 'WAITING_FOR_STAFF', 'NO_LOGIN_BOXES', 'ADDRESS_CHANGED', 'DIDNT_OPEN', 'REFUSED', 'FAILED');

-- CreateTable
CREATE TABLE "PortalLogin" (
    "id" TEXT NOT NULL,
    "departmentId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "loginUrl" TEXT NOT NULL,
    "idLabel" TEXT NOT NULL DEFAULT 'ID',
    "secret" BYTEA,
    "passwordChangedAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "PortalLoginStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PortalLogin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalLoginUser" (
    "portalLoginId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "PortalLoginUser_pkey" PRIMARY KEY ("portalLoginId","userId")
);

-- CreateTable
CREATE TABLE "PortalLoginUse" (
    "id" TEXT NOT NULL,
    "portalLoginId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "openedIp" TEXT,
    "ticketHash" TEXT,
    "ticketExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "redeemedAt" TIMESTAMPTZ(3),
    "redeemedIp" TEXT,
    "outcome" "PortalLoginOutcome",
    "outcomeAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalLoginUse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PortalLogin_departmentId_status_idx" ON "PortalLogin"("departmentId", "status");

-- CreateIndex
CREATE INDEX "PortalLoginUser_userId_idx" ON "PortalLoginUser"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PortalLoginUse_ticketHash_key" ON "PortalLoginUse"("ticketHash");

-- CreateIndex
CREATE INDEX "PortalLoginUse_portalLoginId_redeemedAt_idx" ON "PortalLoginUse"("portalLoginId", "redeemedAt");

-- CreateIndex
CREATE INDEX "PortalLoginUse_redeemedAt_idx" ON "PortalLoginUse"("redeemedAt");

-- CreateIndex
CREATE INDEX "PortalLoginUse_userId_idx" ON "PortalLoginUse"("userId");

-- AddForeignKey
ALTER TABLE "PortalLogin" ADD CONSTRAINT "PortalLogin_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalLogin" ADD CONSTRAINT "PortalLogin_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalLoginUser" ADD CONSTRAINT "PortalLoginUser_portalLoginId_fkey" FOREIGN KEY ("portalLoginId") REFERENCES "PortalLogin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalLoginUser" ADD CONSTRAINT "PortalLoginUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalLoginUse" ADD CONSTRAINT "PortalLoginUse_portalLoginId_fkey" FOREIGN KEY ("portalLoginId") REFERENCES "PortalLogin"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalLoginUse" ADD CONSTRAINT "PortalLoginUse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written (Prisma can't express these).

-- A portal has a name, and its first box a label, never blank and short enough for a card.
ALTER TABLE "PortalLogin" ADD CONSTRAINT "PortalLogin_name_valid" CHECK (btrim("name") <> '' AND char_length("name") <= 80);
ALTER TABLE "PortalLogin" ADD CONSTRAINT "PortalLogin_idLabel_valid" CHECK (btrim("idLabel") <> '' AND char_length("idLabel") <= 30);
-- The login page is a web address.
ALTER TABLE "PortalLogin" ADD CONSTRAINT "PortalLogin_loginUrl_valid" CHECK ("loginUrl" ~ '^https?://[^[:space:]]+$' AND char_length("loginUrl") <= 500);
-- The sealed ID and password are kept exactly while the portal is in use: removing it wipes them.
ALTER TABLE "PortalLogin" ADD CONSTRAINT "PortalLogin_secret_while_active" CHECK (("status" = 'ACTIVE') = ("secret" IS NOT NULL));
ALTER TABLE "PortalLogin" ADD CONSTRAINT "PortalLogin_secret_size" CHECK ("secret" IS NULL OR octet_length("secret") BETWEEN 30 AND 4096);
-- One active portal of a name per department, whatever the case: two "France visa portal" cards would confuse staff.
CREATE UNIQUE INDEX "PortalLogin_department_name_unique" ON "PortalLogin" ("departmentId", lower("name")) WHERE "status" = 'ACTIVE';

-- A ticket expires after it's made; once collected its hash is gone; an outcome always has its time.
ALTER TABLE "PortalLoginUse" ADD CONSTRAINT "PortalLoginUse_expires_after_made" CHECK ("ticketExpiresAt" > "createdAt");
ALTER TABLE "PortalLoginUse" ADD CONSTRAINT "PortalLoginUse_collected_hash_cleared" CHECK ("redeemedAt" IS NULL OR "ticketHash" IS NULL);
ALTER TABLE "PortalLoginUse" ADD CONSTRAINT "PortalLoginUse_outcome_with_time" CHECK (("outcome" IS NULL) = ("outcomeAt" IS NULL));
