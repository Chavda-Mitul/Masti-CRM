-- Covering letters (docs/decisions/0019-covering-letters.md, demo screens 08 and 29): the fixed letter to the embassy
-- for a visa and who travels, filled in from the case and printed on the client's letterhead. A format is for some
-- countries, one visa type and one traveller or several; its wording is kept in versions, each used from its own day,
-- so a change applies only from then on.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- CreateEnum
CREATE TYPE "CoveringLetterParty" AS ENUM ('ONE', 'SEVERAL');

-- CreateTable
CREATE TABLE "CoveringLetterFormat" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "visaTypeId" INTEGER NOT NULL,
    "party" "CoveringLetterParty" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CoveringLetterFormat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoveringLetterCountry" (
    "formatId" INTEGER NOT NULL,
    "countryId" INTEGER NOT NULL,

    CONSTRAINT "CoveringLetterCountry_pkey" PRIMARY KEY ("formatId","countryId")
);

-- CreateTable
CREATE TABLE "CoveringLetterVersion" (
    "id" SERIAL NOT NULL,
    "formatId" INTEGER NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "body" TEXT NOT NULL,
    "addedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoveringLetterVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CoveringLetterFormat_visaTypeId_idx" ON "CoveringLetterFormat"("visaTypeId");

-- CreateIndex
CREATE INDEX "CoveringLetterCountry_countryId_idx" ON "CoveringLetterCountry"("countryId");

-- CreateIndex
CREATE INDEX "CoveringLetterVersion_formatId_effectiveFrom_idx" ON "CoveringLetterVersion"("formatId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "CoveringLetterVersion_addedById_idx" ON "CoveringLetterVersion"("addedById");

-- AddForeignKey
ALTER TABLE "CoveringLetterFormat" ADD CONSTRAINT "CoveringLetterFormat_visaTypeId_fkey" FOREIGN KEY ("visaTypeId") REFERENCES "VisaType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoveringLetterCountry" ADD CONSTRAINT "CoveringLetterCountry_formatId_fkey" FOREIGN KEY ("formatId") REFERENCES "CoveringLetterFormat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoveringLetterCountry" ADD CONSTRAINT "CoveringLetterCountry_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoveringLetterVersion" ADD CONSTRAINT "CoveringLetterVersion_formatId_fkey" FOREIGN KEY ("formatId") REFERENCES "CoveringLetterFormat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoveringLetterVersion" ADD CONSTRAINT "CoveringLetterVersion_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (Prisma can't express these). prisma migrate diff will propose dropping the index; it stays.

-- One format per name, whatever the capitals: "Schengen · tourist · family" and "SCHENGEN · TOURIST · FAMILY" are one.
CREATE UNIQUE INDEX "CoveringLetterFormat_name_unique" ON "CoveringLetterFormat" (lower("name"));

-- A name is always there.
ALTER TABLE "CoveringLetterFormat" ADD CONSTRAINT "CoveringLetterFormat_name_not_blank" CHECK (btrim("name") <> '');

-- A wording is always there, and fits on a page or two (MAX_LETTER_CHARS in coveringLetters.schemas.ts).
ALTER TABLE "CoveringLetterVersion" ADD CONSTRAINT "CoveringLetterVersion_body_not_blank" CHECK (btrim("body") <> '');
ALTER TABLE "CoveringLetterVersion" ADD CONSTRAINT "CoveringLetterVersion_body_length" CHECK (char_length("body") <= 6000);

-- A wording is never edited, and once its day has come (in India) it is never removed either: letters made with it must
-- always be able to show what they said. One whose day is still to come may be removed. TRUNCATE (test setup only)
-- still works, as for invoices and the audit log.
CREATE OR REPLACE FUNCTION covering_letter_version_kept() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'A covering-letter wording is never edited: add a new one instead';
  END IF;
  IF OLD."effectiveFrom" <= (timezone('Asia/Kolkata', now()))::date THEN
    RAISE EXCEPTION 'A covering-letter wording in use since % is never removed', OLD."effectiveFrom";
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CoveringLetterVersion_kept"
  BEFORE UPDATE OR DELETE ON "CoveringLetterVersion"
  FOR EACH ROW EXECUTE FUNCTION covering_letter_version_kept();
