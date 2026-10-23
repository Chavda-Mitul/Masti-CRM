-- How urgent a visa enquiry is (docs/decisions/0003-visa-intake.md amendment 1, change request 17): an admin-editable
-- list, seeded with Normal and Urgent.

-- CreateTable
CREATE TABLE "UrgencyLevel" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "UrgencyLevel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UrgencyLevel_code_key" ON "UrgencyLevel"("code");

-- Hand-written. Codes as in the other lists, and NORMAL, where every new enquiry starts, is never switched off.
ALTER TABLE "UrgencyLevel" ADD CONSTRAINT "UrgencyLevel_code_format" CHECK ("code" ~ '^[A-Z0-9_]{1,40}$');
ALTER TABLE "UrgencyLevel" ADD CONSTRAINT "UrgencyLevel_normal_active" CHECK ("code" <> 'NORMAL' OR "isActive");
