-- The consent form's fields become a master (docs/decisions/0022-consent-form.md amendment 1, change request 18): the
-- Head and the Visa HOD add, rename, reorder and switch off fields. The date of birth and the two addresses stay columns
-- on the person (age and the covering letter read them); every other answer moves to ConsentAnswer. The seven columns
-- below go: no data is kept (we're before go-live; reset the dev database).
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- CreateEnum
CREATE TYPE "ConsentFieldKind" AS ENUM ('TEXT', 'LONG_TEXT', 'DATE', 'NUMBER', 'LINK');

-- CreateEnum
CREATE TYPE "ConsentFixedField" AS ENUM ('DATE_OF_BIRTH', 'HOME_ADDRESS', 'OFFICE_ADDRESS');

-- AlterTable
ALTER TABLE "ClientMember" DROP COLUMN "anniversary",
DROP COLUMN "annualIncome",
DROP COLUMN "education",
DROP COLUMN "fatherDateOfBirth",
DROP COLUMN "motherDateOfBirth",
DROP COLUMN "profession",
DROP COLUMN "spouseDateOfBirth";

-- CreateTable
CREATE TABLE "ConsentField" (
    "id" SERIAL NOT NULL,
    "fixed" "ConsentFixedField",
    "label" TEXT NOT NULL,
    "kind" "ConsentFieldKind" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ConsentField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentAnswer" (
    "memberId" TEXT NOT NULL,
    "fieldId" INTEGER NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "ConsentAnswer_pkey" PRIMARY KEY ("memberId","fieldId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConsentField_fixed_key" ON "ConsentField"("fixed");

-- CreateIndex
CREATE INDEX "ConsentAnswer_fieldId_idx" ON "ConsentAnswer"("fieldId");

-- AddForeignKey
ALTER TABLE "ConsentAnswer" ADD CONSTRAINT "ConsentAnswer_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "ClientMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentAnswer" ADD CONSTRAINT "ConsentAnswer_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "ConsentField"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (Prisma can't express these).

-- A label staff can read, never two the same (ignoring case and spaces at the ends): the form would show both.
ALTER TABLE "ConsentField" ADD CONSTRAINT "ConsentField_label_text" CHECK (btrim("label") <> '' AND char_length("label") <= 100);
CREATE UNIQUE INDEX "ConsentField_label_unique" ON "ConsentField" (lower(btrim("label")));

-- A fixed field keeps the kind its column holds and is never switched off; the date of birth is always required (the
-- child rule needs it, 0022 amendment 2).
ALTER TABLE "ConsentField" ADD CONSTRAINT "ConsentField_fixed_kind" CHECK (
  "fixed" IS NULL
  OR ("fixed" = 'DATE_OF_BIRTH' AND "kind" = 'DATE')
  OR ("fixed" IN ('HOME_ADDRESS', 'OFFICE_ADDRESS') AND "kind" = 'LONG_TEXT')
);
ALTER TABLE "ConsentField" ADD CONSTRAINT "ConsentField_fixed_active" CHECK ("fixed" IS NULL OR "isActive");
ALTER TABLE "ConsentField" ADD CONSTRAINT "ConsentField_birth_required" CHECK ("fixed" IS DISTINCT FROM 'DATE_OF_BIRTH' OR "required");

-- An answer is something: an empty one has no row.
ALTER TABLE "ConsentAnswer" ADD CONSTRAINT "ConsentAnswer_value_text" CHECK (btrim("value") <> '' AND char_length("value") <= 300);
