-- A department's steps belong to a flow (PROJECT_KNOWLEDGE §10.2): Insurance runs policies (4 steps) and claims
-- (7 steps), so steps are unique per department + flow, not per department. Visa has one flow, "VISA".
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- AlterTable: existing steps are all Visa's, so they take the department's code as their flow.
ALTER TABLE "DepartmentStage" ADD COLUMN "flow" TEXT;
UPDATE "DepartmentStage" s SET "flow" = d."code" FROM "Department" d WHERE d."id" = s."departmentId";
ALTER TABLE "DepartmentStage" ALTER COLUMN "flow" SET NOT NULL;
ALTER TABLE "DepartmentStage" ADD CONSTRAINT "DepartmentStage_flow_format" CHECK ("flow" ~ '^[A-Z][A-Z0-9_]{1,39}$');

-- DropIndex
DROP INDEX "DepartmentStage_departmentId_code_key";

-- DropIndex
DROP INDEX "DepartmentStage_departmentId_sortOrder_key";

-- CreateIndex
CREATE UNIQUE INDEX "DepartmentStage_departmentId_flow_code_key" ON "DepartmentStage"("departmentId", "flow", "code");

-- CreateIndex
CREATE UNIQUE INDEX "DepartmentStage_departmentId_flow_sortOrder_key" ON "DepartmentStage"("departmentId", "flow", "sortOrder");
