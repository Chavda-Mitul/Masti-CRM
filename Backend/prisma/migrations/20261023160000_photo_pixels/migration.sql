-- A paper's smallest and largest photo in pixels (docs/decisions/0016-client-documents.md Amendment 1, the project
-- lead on 23 Oct 2026), as visa websites ask: 600 × 600 to 1200 × 1200 for the USA, exactly 400 × 514 for Singapore.

-- AlterTable
ALTER TABLE "DocumentMaster" ADD COLUMN     "maxHeightPx" SMALLINT,
ADD COLUMN     "maxWidthPx" SMALLINT,
ADD COLUMN     "minHeightPx" SMALLINT,
ADD COLUMN     "minWidthPx" SMALLINT;

-- Hand-written. Each pair is both or neither, above 0, and the smallest is not bigger than the largest on either side.
-- The IS NOT NULLs matter: a comparison with NULL is unknown, and a CHECK accepts unknown.
ALTER TABLE "DocumentMaster" ADD CONSTRAINT "DocumentMaster_photo_pixels" CHECK (
  (("minWidthPx" IS NULL AND "minHeightPx" IS NULL)
    OR ("minWidthPx" IS NOT NULL AND "minHeightPx" IS NOT NULL AND "minWidthPx" > 0 AND "minHeightPx" > 0))
  AND (("maxWidthPx" IS NULL AND "maxHeightPx" IS NULL)
    OR ("maxWidthPx" IS NOT NULL AND "maxHeightPx" IS NOT NULL AND "maxWidthPx" > 0 AND "maxHeightPx" > 0))
  AND ("minWidthPx" IS NULL OR "maxWidthPx" IS NULL OR ("minWidthPx" <= "maxWidthPx" AND "minHeightPx" <= "maxHeightPx"))
);
