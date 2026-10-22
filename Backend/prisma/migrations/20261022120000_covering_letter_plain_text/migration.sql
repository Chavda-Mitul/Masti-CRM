-- A visa case's covering letter becomes one text (docs/decisions/0019-covering-letters.md amendment 3, 22 Oct 2026): its
-- tables are lines with | between the columns, no longer { top, table, bottom }.
--
-- Hand-written. prisma migrate diff proposes only SET DATA TYPE TEXT, which would turn a letter made in the old shape into
-- JSON text that passes the new CHECK and prints as {"top":…. (It also proposes dropping "HolidayTarget_unique"; that
-- index is hand-written SQL and stays.)
--
-- Still in development (CLAUDE.md): a letter made in the old shape isn't converted. It's unmade instead: its text,
-- wording, made-at and made-by go back to empty together (VisaCase_covering_letter_together), so a database holding one
-- migrates, and staff make it again. A test database keeps the last test's letter.

UPDATE "VisaCase"
SET "coveringLetterText" = NULL, "coveringLetterVersionId" = NULL, "coveringLetterMadeAt" = NULL, "coveringLetterMadeById" = NULL
WHERE "coveringLetterText" IS NOT NULL;

ALTER TABLE "VisaCase" DROP CONSTRAINT "VisaCase_covering_letter_text_shape";

ALTER TABLE "VisaCase" ALTER COLUMN "coveringLetterText" SET DATA TYPE TEXT USING NULL;

-- Not blank (a text of only spaces and line breaks is refused, which btrim alone wouldn't do) and at most 60,000
-- characters (MAX_CASE_LETTER_CHARS).
ALTER TABLE "VisaCase" ADD CONSTRAINT "VisaCase_covering_letter_text_size" CHECK (
  "coveringLetterText" IS NULL OR ("coveringLetterText" ~ '\S' AND length("coveringLetterText") <= 60000)
);
