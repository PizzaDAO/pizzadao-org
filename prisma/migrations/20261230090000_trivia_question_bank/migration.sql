-- Trivia question bank in the database (it used to be data/trivia/questions.json in the public repo).
-- Purely additive and idempotent: one new table and its indexes. Fill it with scripts/trivia/import-bank.ts.
-- CreateTable
CREATE TABLE IF NOT EXISTS "TriviaQuestion" (
    "id" TEXT NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "pool" VARCHAR(16),
    "category" VARCHAR(32) NOT NULL,
    "data" JSONB NOT NULL,
    "exposed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "TriviaQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TriviaQuestion_status_idx" ON "TriviaQuestion"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TriviaQuestion_pool_idx" ON "TriviaQuestion"("pool");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TriviaQuestion_category_idx" ON "TriviaQuestion"("category");
