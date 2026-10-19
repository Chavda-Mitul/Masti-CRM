-- The notice board (docs/decisions/0017-today-dashboard.md Decision 11, demo screen 27): what each department needs to
-- know, by airline, embassy and hotel. A department's staff post to it; the author, the HOD and the Head change or remove
-- a notice, and a removed one is kept for the record.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- CreateEnum
CREATE TYPE "NoticeCategory" AS ENUM ('AIRLINE', 'EMBASSY', 'HOTEL', 'GENERAL');

-- CreateEnum
CREATE TYPE "NoticeSource" AS ENUM ('TEAM', 'IVS');

-- CreateEnum
CREATE TYPE "NoticeStatus" AS ENUM ('ACTIVE', 'REMOVED');

-- CreateTable
CREATE TABLE "Notice" (
    "id" TEXT NOT NULL,
    "departmentId" INTEGER NOT NULL,
    "category" "NoticeCategory" NOT NULL,
    "about" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "source" "NoticeSource" NOT NULL DEFAULT 'TEAM',
    "status" "NoticeStatus" NOT NULL DEFAULT 'ACTIVE',
    "postedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Notice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notice_status_createdAt_idx" ON "Notice"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Notice_departmentId_status_createdAt_idx" ON "Notice"("departmentId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "Notice" ADD CONSTRAINT "Notice_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notice" ADD CONSTRAINT "Notice_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (Prisma can't express these).

-- A notice says something: a title, never blank.
ALTER TABLE "Notice" ADD CONSTRAINT "Notice_title_not_blank" CHECK (btrim("title") <> '');
-- "Which one" and the details are optional, but never blank when given.
ALTER TABLE "Notice" ADD CONSTRAINT "Notice_about_not_blank" CHECK ("about" IS NULL OR btrim("about") <> '');
ALTER TABLE "Notice" ADD CONSTRAINT "Notice_body_not_blank" CHECK ("body" IS NULL OR btrim("body") <> '');
