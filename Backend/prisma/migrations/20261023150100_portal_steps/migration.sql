-- AlterTable
ALTER TABLE "PortalLogin" ADD COLUMN     "steps" TEXT[] DEFAULT ARRAY[]::TEXT[];
