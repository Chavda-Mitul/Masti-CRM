-- 0011 component 3a (docs/decisions/0011-visa-at-vendor.md Decision 5): the credit-note reasons master. A credit note's
-- reason is picked from it, never typed.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- CreateTable
CREATE TABLE "CreditNoteReason" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CreditNoteReason_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreditNoteReason_code_key" ON "CreditNoteReason"("code");

-- The master code format, as on every other list.
ALTER TABLE "CreditNoteReason" ADD CONSTRAINT "CreditNoteReason_code_format" CHECK ("code" ~ '^[A-Z0-9_]{1,40}$');
