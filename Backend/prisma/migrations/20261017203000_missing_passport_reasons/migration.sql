-- The missing-passport-reasons master (docs/decisions/0013-visa-passport-back.md Decision 5, amended 17 Oct 2026). Why
-- fewer passports came back than went out, when the shortfall is cleared rather than found, is picked from it, never
-- typed, so reports can count why passports go missing.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- CreateTable
CREATE TABLE "MissingPassportReason" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MissingPassportReason_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MissingPassportReason_code_key" ON "MissingPassportReason"("code");

-- The master code format, as on every other list.
ALTER TABLE "MissingPassportReason" ADD CONSTRAINT "MissingPassportReason_code_format" CHECK ("code" ~ '^[A-Z0-9_]{1,40}$');
