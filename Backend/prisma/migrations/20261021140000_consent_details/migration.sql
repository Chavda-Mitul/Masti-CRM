-- The consent form's details on each person (docs/decisions/0022-consent-form.md, part 1): what staff fill in by
-- asking the client, kept for life, plus who last saved them and when.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- AlterTable
ALTER TABLE "ClientMember" ADD COLUMN     "anniversary" DATE,
ADD COLUMN     "annualIncome" INTEGER,
ADD COLUMN     "consentDetailsAt" TIMESTAMPTZ(3),
ADD COLUMN     "consentDetailsById" TEXT,
ADD COLUMN     "education" TEXT,
ADD COLUMN     "fatherDateOfBirth" DATE,
ADD COLUMN     "motherDateOfBirth" DATE,
ADD COLUMN     "officeAddress" TEXT,
ADD COLUMN     "profession" TEXT,
ADD COLUMN     "residentialAddress" TEXT,
ADD COLUMN     "spouseDateOfBirth" DATE;

-- AddForeignKey
ALTER TABLE "ClientMember" ADD CONSTRAINT "ClientMember_consentDetailsById_fkey" FOREIGN KEY ("consentDetailsById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (Prisma can't express these).

-- Saved by someone at some moment: both or neither.
ALTER TABLE "ClientMember" ADD CONSTRAINT "ClientMember_consent_details_by" CHECK (
  ("consentDetailsAt" IS NULL) = ("consentDetailsById" IS NULL)
);
ALTER TABLE "ClientMember" ADD CONSTRAINT "ClientMember_annualIncome_nonnegative" CHECK ("annualIncome" IS NULL OR "annualIncome" >= 0);
ALTER TABLE "ClientMember" ADD CONSTRAINT "ClientMember_residentialAddress_text" CHECK (
  "residentialAddress" IS NULL OR (btrim("residentialAddress") <> '' AND char_length("residentialAddress") <= 300)
);
ALTER TABLE "ClientMember" ADD CONSTRAINT "ClientMember_officeAddress_text" CHECK (
  "officeAddress" IS NULL OR (btrim("officeAddress") <> '' AND char_length("officeAddress") <= 300)
);
ALTER TABLE "ClientMember" ADD CONSTRAINT "ClientMember_profession_text" CHECK (
  "profession" IS NULL OR (btrim("profession") <> '' AND char_length("profession") <= 100)
);
ALTER TABLE "ClientMember" ADD CONSTRAINT "ClientMember_education_text" CHECK (
  "education" IS NULL OR (btrim("education") <> '' AND char_length("education") <= 100)
);
