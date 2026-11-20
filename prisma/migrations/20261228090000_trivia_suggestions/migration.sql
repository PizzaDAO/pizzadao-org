-- Trivia phase 3: community question suggestions reuse TriviaReport. Purely additive: two nullable/defaulted columns
-- (existing rows become kind = 'report') and one index. Safe to apply before the code that reads them is deployed.

-- AlterTable
ALTER TABLE "TriviaReport" ADD COLUMN "kind" VARCHAR(16) NOT NULL DEFAULT 'report',
ADD COLUMN "payload" JSONB;

-- CreateIndex
CREATE INDEX "TriviaReport_kind_status_createdAt_idx" ON "TriviaReport"("kind", "status", "createdAt");
