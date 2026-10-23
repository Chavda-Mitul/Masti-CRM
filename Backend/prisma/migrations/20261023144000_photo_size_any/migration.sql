-- Hand-written. A paper's photo size is only a shape (docs/decisions/0016-client-documents.md Amendment 1, the project
-- lead on 23 Oct 2026): any whole number above 0 on each side, both or neither. It was 10–200 mm. The columns stay
-- SMALLINT, so a side is at most 32,767. The IS NOT NULLs matter: a comparison with NULL is unknown, and a CHECK accepts
-- unknown.
ALTER TABLE "DocumentMaster" DROP CONSTRAINT "DocumentMaster_photo_size";
ALTER TABLE "DocumentMaster" ADD CONSTRAINT "DocumentMaster_photo_size" CHECK (
  ("photoWidthMm" IS NULL AND "photoHeightMm" IS NULL)
  OR ("photoWidthMm" IS NOT NULL AND "photoHeightMm" IS NOT NULL AND "photoWidthMm" > 0 AND "photoHeightMm" > 0)
);
