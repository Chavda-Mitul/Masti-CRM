-- The client document vault (docs/decisions/0016-client-documents.md): scans of a client's papers, per family member,
-- kept in the private bucket and reused on later cases. Never changed or deleted; the newest per person and paper is
-- the current one.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- CreateTable
CREATE TABLE "ClientDocument" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "memberId" TEXT,
    "documentId" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "pageCount" INTEGER,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientDocument_storageKey_key" ON "ClientDocument"("storageKey");

-- CreateIndex
CREATE INDEX "ClientDocument_clientId_uploadedAt_idx" ON "ClientDocument"("clientId", "uploadedAt");

-- CreateIndex
CREATE INDEX "ClientDocument_memberId_documentId_uploadedAt_idx" ON "ClientDocument"("memberId", "documentId", "uploadedAt");

-- CreateIndex
CREATE INDEX "ClientDocument_documentId_idx" ON "ClientDocument"("documentId");

-- CreateIndex
CREATE INDEX "ClientDocument_uploadedById_idx" ON "ClientDocument"("uploadedById");

-- AddForeignKey
ALTER TABLE "ClientDocument" ADD CONSTRAINT "ClientDocument_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDocument" ADD CONSTRAINT "ClientDocument_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "ClientMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDocument" ADD CONSTRAINT "ClientDocument_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DocumentMaster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDocument" ADD CONSTRAINT "ClientDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written (Prisma can't express these).

-- A scanner's PDF or a phone photo; the largest size is the clients.documents setting.
ALTER TABLE "ClientDocument" ADD CONSTRAINT "ClientDocument_type" CHECK ("contentType" IN ('application/pdf', 'image/png', 'image/jpeg'));
ALTER TABLE "ClientDocument" ADD CONSTRAINT "ClientDocument_size" CHECK ("sizeBytes" > 0);

-- A PDF has its pages counted; a photo has none.
ALTER TABLE "ClientDocument" ADD CONSTRAINT "ClientDocument_pages" CHECK (("contentType" = 'application/pdf') = ("pageCount" IS NOT NULL) AND ("pageCount" IS NULL OR "pageCount" > 0));
