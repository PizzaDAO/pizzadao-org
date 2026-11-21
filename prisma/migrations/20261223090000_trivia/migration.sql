-- Trivia (plans/done/trivia.md, phase 1). Purely additive: one enum value, two enums, three new tables.
-- Nothing reads or writes these tables from the Discord side yet (phase 2); the web daily writes TriviaRound/TriviaAttempt,
-- and "report a problem" writes TriviaReport.

-- AlterEnum (written from phase 2; added now so the enum stays in sync)
ALTER TYPE "TransactionType" ADD VALUE 'TRIVIA_REWARD';

-- CreateEnum
CREATE TYPE "TriviaRoundStatus" AS ENUM ('OPEN', 'WON', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TriviaSurface" AS ENUM ('DISCORD', 'WEB_DAILY');

-- CreateTable
CREATE TABLE "TriviaRound" (
    "id" SERIAL NOT NULL,
    "surface" "TriviaSurface" NOT NULL,
    "questionId" TEXT NOT NULL,
    "status" "TriviaRoundStatus" NOT NULL DEFAULT 'OPEN',
    "channelId" TEXT,
    "messageId" TEXT,
    "dayKey" TEXT,
    "rewardPep" INTEGER NOT NULL DEFAULT 0,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "winnerDiscordId" TEXT,
    "winnerMessageId" TEXT,
    "wonAt" TIMESTAMP(3),

    CONSTRAINT "TriviaRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriviaAttempt" (
    "id" SERIAL NOT NULL,
    "roundId" INTEGER NOT NULL,
    "discordId" TEXT NOT NULL,
    "messageId" TEXT,
    "correct" BOOLEAN NOT NULL,
    "answerText" VARCHAR(120),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TriviaAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TriviaReport" (
    "id" SERIAL NOT NULL,
    "questionId" TEXT NOT NULL,
    "discordId" TEXT,
    "text" VARCHAR(500) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TriviaReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TriviaRound_messageId_key" ON "TriviaRound"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "TriviaRound_dayKey_key" ON "TriviaRound"("dayKey");

-- CreateIndex
CREATE INDEX "TriviaRound_surface_status_idx" ON "TriviaRound"("surface", "status");

-- CreateIndex
CREATE INDEX "TriviaRound_questionId_idx" ON "TriviaRound"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "TriviaAttempt_messageId_key" ON "TriviaAttempt"("messageId");

-- CreateIndex
CREATE INDEX "TriviaAttempt_roundId_discordId_idx" ON "TriviaAttempt"("roundId", "discordId");

-- CreateIndex
CREATE INDEX "TriviaAttempt_discordId_createdAt_idx" ON "TriviaAttempt"("discordId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TriviaAttempt_roundId_discordId_messageId_key" ON "TriviaAttempt"("roundId", "discordId", "messageId");

-- CreateIndex
CREATE INDEX "TriviaReport_status_createdAt_idx" ON "TriviaReport"("status", "createdAt");

-- Partial unique indexes Prisma cannot express (they are not in schema.prisma; `migrate dev` leaves them alone).
-- At most one OPEN Discord round per channel (the race guard for two crons opening at once, phase 2).
CREATE UNIQUE INDEX "TriviaRound_one_open_discord_per_channel" ON "TriviaRound"("channelId") WHERE "status" = 'OPEN' AND "surface" = 'DISCORD';
-- A web (non-Discord-message) attempt is once per user per round: NULL messageId rows are not covered by the
-- (roundId, discordId, messageId) unique above, so this closes the double-submit race on the web daily.
CREATE UNIQUE INDEX "TriviaAttempt_web_once_per_round" ON "TriviaAttempt"("roundId", "discordId") WHERE "messageId" IS NULL;

-- AddForeignKey
ALTER TABLE "TriviaAttempt" ADD CONSTRAINT "TriviaAttempt_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "TriviaRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;
