-- Follow-up and reason dropdowns are tagged with the departments they show in (docs/decisions/0018-dropdowns-by-department.md).
-- Each value has one or more departments; a case's dropdowns list only the values tagged with its department, and the
-- service refuses any other. "At least one department" is checked by the service, as for a vendor's countries.
-- Rows made before this migration have no departments: reset and reseed the dev database (no live data before go-live).
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- CreateTable
CREATE TABLE "FollowUpOutcomeDepartment" (
    "outcomeId" INTEGER NOT NULL,
    "departmentId" INTEGER NOT NULL,

    CONSTRAINT "FollowUpOutcomeDepartment_pkey" PRIMARY KEY ("outcomeId","departmentId")
);

-- CreateTable
CREATE TABLE "FollowUpNextStepDepartment" (
    "nextStepId" INTEGER NOT NULL,
    "departmentId" INTEGER NOT NULL,

    CONSTRAINT "FollowUpNextStepDepartment_pkey" PRIMARY KEY ("nextStepId","departmentId")
);

-- CreateTable
CREATE TABLE "EnquiryReasonDepartment" (
    "reasonId" INTEGER NOT NULL,
    "departmentId" INTEGER NOT NULL,

    CONSTRAINT "EnquiryReasonDepartment_pkey" PRIMARY KEY ("reasonId","departmentId")
);

-- CreateIndex
CREATE INDEX "FollowUpOutcomeDepartment_departmentId_idx" ON "FollowUpOutcomeDepartment"("departmentId");

-- CreateIndex
CREATE INDEX "FollowUpNextStepDepartment_departmentId_idx" ON "FollowUpNextStepDepartment"("departmentId");

-- CreateIndex
CREATE INDEX "EnquiryReasonDepartment_departmentId_idx" ON "EnquiryReasonDepartment"("departmentId");

-- AddForeignKey
ALTER TABLE "FollowUpOutcomeDepartment" ADD CONSTRAINT "FollowUpOutcomeDepartment_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "FollowUpOutcome"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpOutcomeDepartment" ADD CONSTRAINT "FollowUpOutcomeDepartment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpNextStepDepartment" ADD CONSTRAINT "FollowUpNextStepDepartment_nextStepId_fkey" FOREIGN KEY ("nextStepId") REFERENCES "FollowUpNextStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpNextStepDepartment" ADD CONSTRAINT "FollowUpNextStepDepartment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnquiryReasonDepartment" ADD CONSTRAINT "EnquiryReasonDepartment_reasonId_fkey" FOREIGN KEY ("reasonId") REFERENCES "EnquiryReason"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnquiryReasonDepartment" ADD CONSTRAINT "EnquiryReasonDepartment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

