-- A paper's upload rules (docs/decisions/0016-client-documents.md Amendment 1, change request 16).

-- CreateEnum
CREATE TYPE "ScanFileType" AS ENUM ('PDF', 'JPG', 'PNG');

-- AlterTable
ALTER TABLE "DocumentMaster" ADD COLUMN     "fileTypes" "ScanFileType"[] DEFAULT ARRAY['PDF', 'JPG', 'PNG']::"ScanFileType"[],
ADD COLUMN     "maxSizeMb" DOUBLE PRECISION,
ADD COLUMN     "minSizeMb" DOUBLE PRECISION,
ADD COLUMN     "photoHeightMm" SMALLINT,
ADD COLUMN     "photoWidthMm" SMALLINT;

-- Hand-written. At least one file type. Prisma leaves list columns nullable, so the CHECK refuses NULL itself.
ALTER TABLE "DocumentMaster" ADD CONSTRAINT "DocumentMaster_fileTypes_some" CHECK ("fileTypes" IS NOT NULL AND cardinality("fileTypes") >= 1);
-- Sizes are 0.01–50 MB, the smallest below the largest.
ALTER TABLE "DocumentMaster" ADD CONSTRAINT "DocumentMaster_size_range" CHECK (
  ("minSizeMb" IS NULL OR "minSizeMb" BETWEEN 0.01 AND 50)
  AND ("maxSizeMb" IS NULL OR "maxSizeMb" BETWEEN 0.01 AND 50)
  AND ("minSizeMb" IS NULL OR "maxSizeMb" IS NULL OR "minSizeMb" < "maxSizeMb")
);
-- A photo size has both sides, each 10–200 mm, or neither. The IS NOT NULLs matter: one side NULL in a BETWEEN is
-- unknown, and a CHECK accepts unknown.
ALTER TABLE "DocumentMaster" ADD CONSTRAINT "DocumentMaster_photo_size" CHECK (
  ("photoWidthMm" IS NULL AND "photoHeightMm" IS NULL)
  OR ("photoWidthMm" IS NOT NULL AND "photoHeightMm" IS NOT NULL
      AND "photoWidthMm" BETWEEN 10 AND 200 AND "photoHeightMm" BETWEEN 10 AND 200)
);
