-- Machine accounts and all AI-bot support removed (project lead, 9 Oct 2026; docs/decisions/0005-system-masters.md, Amendment).
-- The holiday calendar is staff-entered only. A future bot gets its own design.

-- 1. Unreviewed bot suggestions go (their targets cascade). Bot entries a person confirmed stay as ordinary holidays.
DELETE FROM "Holiday" WHERE "status" = 'PENDING';

-- 2. The rule tying source to the machine account and bot key goes with those columns.
ALTER TABLE "Holiday" DROP CONSTRAINT "Holiday_source";

-- 3. HolidayStatus without PENDING.
BEGIN;
CREATE TYPE "HolidayStatus_new" AS ENUM ('ACTIVE', 'REMOVED');
ALTER TABLE "public"."Holiday" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Holiday" ALTER COLUMN "status" TYPE "HolidayStatus_new" USING ("status"::text::"HolidayStatus_new");
ALTER TYPE "HolidayStatus" RENAME TO "HolidayStatus_old";
ALTER TYPE "HolidayStatus_new" RENAME TO "HolidayStatus";
DROP TYPE "public"."HolidayStatus_old";
ALTER TABLE "Holiday" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
COMMIT;

-- DropForeignKey
ALTER TABLE "ApiClient" DROP CONSTRAINT "ApiClient_createdById_fkey";

-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_apiClientId_fkey";

-- DropForeignKey
ALTER TABLE "Holiday" DROP CONSTRAINT "Holiday_apiClientId_fkey";

-- DropForeignKey
ALTER TABLE "Holiday" DROP CONSTRAINT "Holiday_reviewedById_fkey";

-- DropIndex
DROP INDEX "AuditLog_apiClientId_idx";

-- DropIndex
DROP INDEX "Holiday_apiClientId_updatedAt_idx";

-- DropIndex
DROP INDEX "Holiday_externalKey_key";

-- (HolidayTarget_unique stays: it is hand-written, NULLS NOT DISTINCT, which Prisma can't describe.)

-- AlterTable: a schema change, not an UPDATE, so the audit log's append-only trigger doesn't apply.
ALTER TABLE "AuditLog" DROP COLUMN "apiClientId";

-- AlterTable
ALTER TABLE "Holiday" DROP COLUMN "apiClientId",
DROP COLUMN "externalKey",
DROP COLUMN "reviewedAt",
DROP COLUMN "reviewedById",
DROP COLUMN "source";

-- DropTable
DROP TABLE "ApiClient";

-- DropEnum
DROP TYPE "ApiScope";

-- DropEnum
DROP TYPE "HolidaySource";
