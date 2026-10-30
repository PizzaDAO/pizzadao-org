-- CreateEnum
CREATE TYPE "HostMatchConsent" AS ENUM ('PENDING', 'INVITED', 'CONFIRMED', 'DECLINED');

-- CreateTable
CREATE TABLE "TelegramHostMatch" (
    "discordId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "handleHint" VARCHAR(8),
    "matchedBy" VARCHAR(16) NOT NULL DEFAULT 'email',
    "consent" "HostMatchConsent" NOT NULL DEFAULT 'PENDING',
    "invitedAt" TIMESTAMP(3),
    "memberConfirmedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "matchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramHostMatch_pkey" PRIMARY KEY ("discordId")
);

-- CreateTable
CREATE TABLE "TelegramHostMatchCheck" (
    "memberId" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramHostMatchCheck_pkey" PRIMARY KEY ("memberId")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramHostMatch_telegramId_key" ON "TelegramHostMatch"("telegramId");

-- CreateIndex
CREATE INDEX "TelegramHostMatch_consent_idx" ON "TelegramHostMatch"("consent");

-- CreateIndex
CREATE INDEX "TelegramHostMatchCheck_checkedAt_idx" ON "TelegramHostMatchCheck"("checkedAt");
