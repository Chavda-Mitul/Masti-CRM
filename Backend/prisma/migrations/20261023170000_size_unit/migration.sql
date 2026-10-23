-- A paper's min and max file size in KB or MB (docs/decisions/0016-client-documents.md Amendment 1, the project lead
-- on 23 Oct 2026): visa websites state a photo's limit in KB (240 KB for the USA, 60 KB for Singapore). The sizes are
-- renamed, not dropped and added as the diff proposed, so a size already set keeps its value, in MB.

-- CreateEnum
CREATE TYPE "SizeUnit" AS ENUM ('KB', 'MB');

-- AlterTable
ALTER TABLE "DocumentMaster" RENAME COLUMN "minSizeMb" TO "minSize";
ALTER TABLE "DocumentMaster" RENAME COLUMN "maxSizeMb" TO "maxSize";
ALTER TABLE "DocumentMaster" ADD COLUMN "sizeUnit" "SizeUnit" NOT NULL DEFAULT 'MB';

-- Hand-written. Sizes per unit: MB 0.01–50, KB a whole number 1–51,200 (the same 50 MB); the smallest below the
-- largest. (MB's 2 decimals are checked by the app: a double can't be compared to hundredths exactly.)
ALTER TABLE "DocumentMaster" DROP CONSTRAINT "DocumentMaster_size_range";
ALTER TABLE "DocumentMaster" ADD CONSTRAINT "DocumentMaster_size_range" CHECK (
  CASE "sizeUnit"
    WHEN 'MB' THEN ("minSize" IS NULL OR "minSize" BETWEEN 0.01 AND 50)
               AND ("maxSize" IS NULL OR "maxSize" BETWEEN 0.01 AND 50)
    WHEN 'KB' THEN ("minSize" IS NULL OR ("minSize" BETWEEN 1 AND 51200 AND "minSize" = trunc("minSize")))
               AND ("maxSize" IS NULL OR ("maxSize" BETWEEN 1 AND 51200 AND "maxSize" = trunc("maxSize")))
  END
  AND ("minSize" IS NULL OR "maxSize" IS NULL OR "minSize" < "maxSize")
);
