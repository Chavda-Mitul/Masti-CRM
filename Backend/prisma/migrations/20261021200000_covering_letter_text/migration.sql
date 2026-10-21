-- A made covering letter is its text (docs/decisions/0019-covering-letters.md amendment 1, 21 Oct 2026): staff may change
-- any of it before making it, so the case keeps the letter as made ({ top, table, bottom }) instead of what its wording
-- was filled in with ({ values, travellers }).
--
-- Hand-written: prisma migrate diff would drop the column and add a new one, which also drops the CHECK that keeps the
-- four details together. A rename keeps it (Postgres renames the column inside the CHECK).
-- A dev database with letters made before this keeps them in the old shape: reset it (npx prisma migrate reset, then
-- npm run db:seed) or make them again.

ALTER TABLE "VisaCase" RENAME COLUMN "coveringLetterFill" TO "coveringLetterText";

-- The letter's shape, and a bound on its size: two parts of at most 8,000 characters and a table of at most 60 rows of
-- 6 cells of 200 (src/modules/coveringLetters/coveringLetters.schemas.ts) fit well inside 120,000. A key left out gives
-- NULL, which a CHECK would let through, hence the COALESCEs.
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_covering_letter_text_shape" CHECK (
  "coveringLetterText" IS NULL
  OR (
    jsonb_typeof("coveringLetterText") = 'object'
    AND COALESCE(jsonb_typeof("coveringLetterText" -> 'top'), '') = 'string'
    AND COALESCE(jsonb_typeof("coveringLetterText" -> 'bottom'), '') = 'string'
    AND COALESCE(jsonb_typeof("coveringLetterText" -> 'table'), '') IN ('object', 'null')
    AND length("coveringLetterText"::text) <= 120000
  )
);
