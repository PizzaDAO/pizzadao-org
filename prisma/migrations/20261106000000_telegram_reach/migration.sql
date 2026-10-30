-- Telegram reachability over the shared sender bot, plus snooze and the "why not Telegram" note on follow-ups.
-- Additive only.
CREATE TYPE "TelegramReachState" AS ENUM ('UNKNOWN', 'OK', 'NOT_STARTED', 'BLOCKED');

CREATE TABLE "TelegramReach" (
    "telegramId" TEXT NOT NULL,
    "state" "TelegramReachState" NOT NULL DEFAULT 'UNKNOWN',
    "failures" INTEGER NOT NULL DEFAULT 0,
    "checkedAt" TIMESTAMP(3),
    "recheckAt" TIMESTAMP(3),
    "lastCode" VARCHAR(32),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramReach_pkey" PRIMARY KEY ("telegramId")
);

ALTER TABLE "FollowUp" ADD COLUMN "snoozedUntil" TIMESTAMP(3);
ALTER TABLE "FollowUp" ADD COLUMN "telegramFallback" VARCHAR(32);
