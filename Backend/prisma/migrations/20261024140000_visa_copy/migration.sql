-- An approved paper visa's visa copy: the passport's visa page or the approval letter, kept as one PDF with its traveller
-- (docs/decisions/0012-visa-decision.md Decision 3, amended 24 Oct 2026, change request 21, part 2).
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- AlterEnum
ALTER TYPE "CaseFileKind" ADD VALUE 'VISA_COPY';

-- Hand-written (Prisma can't express these). A visa copy has a traveller, like a refusal letter and an e-visa, and
-- nothing else does. The kind is compared as text: the new value can't be used before this migration commits.
ALTER TABLE "CaseFile" DROP CONSTRAINT "CaseFile_traveller";
ALTER TABLE "CaseFile" ADD CONSTRAINT "CaseFile_traveller" CHECK (("kind"::text IN ('REFUSAL_LETTER', 'EVISA', 'VISA_COPY')) = ("travellerId" IS NOT NULL));
