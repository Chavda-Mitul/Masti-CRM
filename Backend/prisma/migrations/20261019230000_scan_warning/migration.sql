-- The "Scan not saved" warning, switched on per document (docs/decisions/0016-client-documents.md Decision 7).
ALTER TABLE "DocumentMaster" ADD COLUMN     "warnIfNoScan" BOOLEAN NOT NULL DEFAULT false;
