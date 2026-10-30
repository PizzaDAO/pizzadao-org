-- CreateEnum
CREATE TYPE "TelegramPostStatus" AS ENUM ('PENDING', 'SENT', 'SKIPPED', 'FAILED', 'UNCERTAIN');

-- CreateTable
CREATE TABLE "TelegramGroupPost" (
    "id" TEXT NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "sourceId" VARCHAR(120) NOT NULL,
    "crewId" VARCHAR(64),
    "crewLabel" VARCHAR(120),
    "cityKey" VARCHAR(80) NOT NULL,
    "text" TEXT NOT NULL,
    "status" "TelegramPostStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sendAfter" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "messageId" TEXT,
    "code" VARCHAR(32),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "TelegramGroupPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TelegramGroupPost_status_sendAfter_idx" ON "TelegramGroupPost"("status", "sendAfter");

-- CreateIndex
CREATE INDEX "TelegramGroupPost_cityKey_sentAt_idx" ON "TelegramGroupPost"("cityKey", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramGroupPost_kind_sourceId_cityKey_key" ON "TelegramGroupPost"("kind", "sourceId", "cityKey");
