-- Trigram matching for the client search ("any part of a name or number").
-- pg_trgm ships with PostgreSQL (contrib) and is a trusted extension, so the database owner can create it.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- AuditLog.clientId is new; older client rows stay without it (written before go-live, no backfill:
-- the table is append-only).
-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "clientId" TEXT;

-- AlterTable
ALTER TABLE "Client" ALTER COLUMN "clientSince" SET DEFAULT (timezone('Asia/Kolkata'::text, now()))::date;

-- CreateIndex
CREATE INDEX "AuditLog_clientId_createdAt_idx" ON "AuditLog"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "Client_name_trgm_idx" ON "Client" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Client_contactPerson_trgm_idx" ON "Client" USING GIN ("contactPerson" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Client_mobile_trgm_idx" ON "Client" USING GIN ("mobile" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "ClientMember_name_trgm_idx" ON "ClientMember" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "ClientPhone_mobile_trgm_idx" ON "ClientPhone" USING GIN ("mobile" gin_trgm_ops);
