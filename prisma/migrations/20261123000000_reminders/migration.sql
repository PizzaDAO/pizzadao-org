-- CreateEnum
CREATE TYPE "ReminderCalls" AS ENUM ('NONE', 'COMMUNITY', 'MY_CREWS', 'SELECTED');

-- CreateEnum
CREATE TYPE "ReminderChannel" AS ENUM ('AUTO', 'DISCORD', 'TELEGRAM');

-- CreateEnum
CREATE TYPE "ReminderKind" AS ENUM ('CALL', 'CALL_MOVED', 'PROPOSAL_OPENED', 'PROPOSAL_CLOSING');

-- CreateTable
CREATE TABLE "ReminderPref" (
    "discordId" TEXT NOT NULL,
    "calls" "ReminderCalls" NOT NULL DEFAULT 'NONE',
    "crewIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "callLeadMinutes" INTEGER,
    "proposalOpened" BOOLEAN NOT NULL DEFAULT false,
    "proposalClosing" BOOLEAN NOT NULL DEFAULT false,
    "channel" "ReminderChannel" NOT NULL DEFAULT 'AUTO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderPref_pkey" PRIMARY KEY ("discordId")
);

-- CreateTable
CREATE TABLE "ReminderSend" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "kind" "ReminderKind" NOT NULL,
    "refKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "channel" TEXT,
    "code" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReminderSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscordDmReach" (
    "discordId" TEXT NOT NULL,
    "dmChannelId" TEXT,
    "state" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "recheckAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),

    CONSTRAINT "DiscordDmReach_pkey" PRIMARY KEY ("discordId")
);

-- CreateIndex
CREATE INDEX "ReminderPref_calls_idx" ON "ReminderPref"("calls");

-- CreateIndex
CREATE INDEX "ReminderSend_kind_refKey_idx" ON "ReminderSend"("kind", "refKey");

-- CreateIndex
CREATE INDEX "ReminderSend_discordId_createdAt_idx" ON "ReminderSend"("discordId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderSend_discordId_kind_refKey_key" ON "ReminderSend"("discordId", "kind", "refKey");
