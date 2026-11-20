-- Web daily trivia $PEP (trivia.webDailyRewardPep). Purely additive: one enum value and one nullable column.
-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'TRIVIA_DAILY_REWARD';

-- AlterTable
ALTER TABLE "TriviaAttempt" ADD COLUMN "rewardedPep" INTEGER;
