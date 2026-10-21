-- AI calls (docs/decisions/0023-ai.md): every call through src/lib/ai's askAi(), with its tokens and cost, whatever the
-- outcome. The prompt and the reply aren't kept: they hold client details. A new table only.
--
-- (prisma migrate diff also proposes dropping "HolidayTarget_unique"; that index is hand-written SQL and stays.)

-- CreateEnum
CREATE TYPE "AiCallStatus" AS ENUM ('OK', 'FAILED', 'REFUSED');

-- CreateTable
CREATE TABLE "AiCall" (
    "id" TEXT NOT NULL,
    "useCase" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" "AiCallStatus" NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "costMicroUsd" INTEGER,
    "durationMs" INTEGER NOT NULL,
    "error" TEXT,
    "userId" TEXT,
    "enquiryId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiCall_createdAt_idx" ON "AiCall"("createdAt");

-- CreateIndex
CREATE INDEX "AiCall_enquiryId_createdAt_idx" ON "AiCall"("enquiryId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiCall" ADD CONSTRAINT "AiCall_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiCall" ADD CONSTRAINT "AiCall_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written (Prisma can't express these).

ALTER TABLE "AiCall" ADD CONSTRAINT "AiCall_useCase_not_blank" CHECK (btrim("useCase") <> '');
ALTER TABLE "AiCall" ADD CONSTRAINT "AiCall_provider_not_blank" CHECK (btrim("provider") <> '');
ALTER TABLE "AiCall" ADD CONSTRAINT "AiCall_model_not_blank" CHECK (btrim("model") <> '');
ALTER TABLE "AiCall" ADD CONSTRAINT "AiCall_error_not_blank" CHECK ("error" IS NULL OR btrim("error") <> '');
ALTER TABLE "AiCall" ADD CONSTRAINT "AiCall_numbers_nonnegative" CHECK (
  "durationMs" >= 0
  AND ("inputTokens" IS NULL OR "inputTokens" >= 0)
  AND ("outputTokens" IS NULL OR "outputTokens" >= 0)
  AND ("costMicroUsd" IS NULL OR "costMicroUsd" >= 0)
);
-- The AI bills tokens in and out together, and a cost needs them.
ALTER TABLE "AiCall" ADD CONSTRAINT "AiCall_tokens_together" CHECK (("inputTokens" IS NULL) = ("outputTokens" IS NULL));
ALTER TABLE "AiCall" ADD CONSTRAINT "AiCall_cost_needs_tokens" CHECK ("costMicroUsd" IS NULL OR "inputTokens" IS NOT NULL);
-- An answer and a refusal were billed, so they have tokens. Only an answer has no error; a failure may have tokens (a
-- cut-off answer) or not (the AI was never reached).
ALTER TABLE "AiCall" ADD CONSTRAINT "AiCall_outcome" CHECK (
  CASE "status"
    WHEN 'OK' THEN "error" IS NULL AND "inputTokens" IS NOT NULL
    WHEN 'REFUSED' THEN "error" IS NOT NULL AND "inputTokens" IS NOT NULL
    ELSE "error" IS NOT NULL
  END
);
