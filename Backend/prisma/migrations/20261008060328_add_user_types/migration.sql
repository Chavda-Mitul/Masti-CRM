-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('HEAD', 'OFFICE', 'FIELD');

-- AlterTable
ALTER TABLE "User" DROP COLUMN "isHead",
ADD COLUMN     "type" "UserType" NOT NULL DEFAULT 'OFFICE';

-- CreateTable
CREATE TABLE "FieldJob" (
    "id" TEXT NOT NULL,
    "departmentId" INTEGER NOT NULL,
    "assigneeId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "FieldJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FieldJob_assigneeId_idx" ON "FieldJob"("assigneeId");

-- CreateIndex
CREATE INDEX "FieldJob_departmentId_idx" ON "FieldJob"("departmentId");

-- CreateIndex
CREATE INDEX "User_type_isActive_idx" ON "User"("type", "isActive");

-- AddForeignKey
ALTER TABLE "FieldJob" ADD CONSTRAINT "FieldJob_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FieldJob" ADD CONSTRAINT "FieldJob_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written integrity rules (Prisma can't express these). See docs/decisions/0002-user-types.md.
-- ---------------------------------------------------------------------------

-- Field staff get their jobs and handover OTPs on WhatsApp, so they need a mobile.
ALTER TABLE "User" ADD CONSTRAINT "User_field_needs_mobile" CHECK ("type" <> 'FIELD' OR "mobile" IS NOT NULL);

-- Only OFFICE users have department roles: HEAD already has every department, FIELD has none.
-- Two triggers guard both directions: adding a department row, and changing a user's type.
CREATE OR REPLACE FUNCTION user_department_office_only() RETURNS trigger AS $$
DECLARE
  user_type "UserType";
BEGIN
  -- FOR SHARE waits for a concurrent type change on this user, so the two triggers can't both pass.
  SELECT "type" INTO user_type FROM "User" WHERE "id" = NEW."userId" FOR SHARE;
  -- A missing user is left to the foreign key.
  IF FOUND AND user_type <> 'OFFICE' THEN
    RAISE EXCEPTION 'Only OFFICE users can have department roles (user % is %)', NEW."userId", user_type;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "UserDepartment_office_only"
  BEFORE INSERT OR UPDATE OF "userId" ON "UserDepartment"
  FOR EACH ROW EXECUTE FUNCTION user_department_office_only();

CREATE OR REPLACE FUNCTION user_type_without_departments() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "UserDepartment" WHERE "userId" = NEW."id") THEN
    RAISE EXCEPTION 'Remove the department roles of user % before making them %', NEW."id", NEW."type";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "User_type_without_departments"
  BEFORE UPDATE OF "type" ON "User"
  FOR EACH ROW WHEN (NEW."type" <> 'OFFICE')
  EXECUTE FUNCTION user_type_without_departments();
