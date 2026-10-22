-- E-visas after the decision, part 1 (docs/decisions/0025-evisa-after-decision.md): an approved e-visa traveller's
-- e-visa, as the portal issued it, kept as a PDF with the case's files. A newer upload is the current one; older ones
-- stay as proof. Its check against the passport reuses "VisaCaseTraveller"."stickerCheck".
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- AlterEnum
ALTER TYPE "CaseFileKind" ADD VALUE 'EVISA';


-- Hand-written (Prisma can't express these).

-- A refusal letter or an e-visa is for one traveller, and only those two kinds have one. The kind is compared as text:
-- Postgres doesn't allow the new enum value itself until this migration is committed.
ALTER TABLE "CaseFile" DROP CONSTRAINT "CaseFile_refusal_letter_traveller";
ALTER TABLE "CaseFile" ADD CONSTRAINT "CaseFile_traveller" CHECK (("kind"::text IN ('REFUSAL_LETTER', 'EVISA')) = ("travellerId" IS NOT NULL));
