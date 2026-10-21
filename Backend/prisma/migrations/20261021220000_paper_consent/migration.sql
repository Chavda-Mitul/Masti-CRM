-- Consents signed on paper before the CRM (docs/decisions/0022-consent-form.md, part 3): the Head or the Visa HOD
-- marks them on file with the year, so those people never get a link. A consent now says how it came: LINK (the
-- client tapped "I agree") or PAPER. Every consent so far came through the link, hence the default.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- CreateEnum
CREATE TYPE "ConsentSource" AS ENUM ('LINK', 'PAPER');

-- AlterTable
ALTER TABLE "Consent" ADD COLUMN     "markedById" TEXT,
ADD COLUMN     "paperYear" INTEGER,
ADD COLUMN     "source" "ConsentSource" NOT NULL DEFAULT 'LINK',
ALTER COLUMN "details" DROP NOT NULL,
ALTER COLUMN "linkId" DROP NOT NULL,
ALTER COLUMN "wordingId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_markedById_fkey" FOREIGN KEY ("markedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (Prisma can't express these).

-- Each source has exactly its own fields: a consent through the link keeps the wording, the link and the details it was
-- given with; a paper one keeps only the year it was signed and who marked it.
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_source_fields" CHECK (
  ("source" = 'LINK' AND "wordingId" IS NOT NULL AND "linkId" IS NOT NULL AND "details" IS NOT NULL
    AND "paperYear" IS NULL AND "markedById" IS NULL)
  OR ("source" = 'PAPER' AND "paperYear" IS NOT NULL AND "markedById" IS NOT NULL
    AND "wordingId" IS NULL AND "linkId" IS NULL AND "details" IS NULL AND "ip" IS NULL AND "userAgent" IS NULL)
);
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_paperYear_range" CHECK ("paperYear" IS NULL OR "paperYear" BETWEEN 1990 AND 2100);

-- A consent is evidence: never changed, and never removed, except a paper one marked by mistake. (TRUNCATE, for tests,
-- still works.)
CREATE OR REPLACE FUNCTION consent_kept() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD."source" = 'PAPER' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'A consent is never changed, and only a paper one is removed (% refused)', TG_OP;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Consent_kept" BEFORE UPDATE OR DELETE ON "Consent"
  FOR EACH ROW EXECUTE FUNCTION consent_kept();
