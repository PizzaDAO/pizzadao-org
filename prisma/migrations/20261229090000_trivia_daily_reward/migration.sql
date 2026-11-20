-- Web daily trivia $PEP (trivia.webDailyRewardPep). Purely additive and idempotent: one enum value, one new table.
-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'TRIVIA_DAILY_REWARD';

-- CreateTable
CREATE TABLE IF NOT EXISTS "TriviaDailyReward" (
    "id" SERIAL NOT NULL,
    "discordId" TEXT NOT NULL,
    "dayKey" TEXT NOT NULL,
    "pep" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TriviaDailyReward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TriviaDailyReward_discordId_dayKey_key" ON "TriviaDailyReward"("discordId", "dayKey");
