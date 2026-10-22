-- The red dot on a department in the sidebar (docs/decisions/0006-visa-documents.md amendment 22): a case the HOD or the
-- Head gave to someone, who hasn't clicked that department since.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- CreateTable
CREATE TABLE "UnseenAssignment" (
    "enquiryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnseenAssignment_pkey" PRIMARY KEY ("enquiryId")
);

-- CreateIndex
CREATE INDEX "UnseenAssignment_userId_idx" ON "UnseenAssignment"("userId");

-- AddForeignKey
ALTER TABLE "UnseenAssignment" ADD CONSTRAINT "UnseenAssignment_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnseenAssignment" ADD CONSTRAINT "UnseenAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
