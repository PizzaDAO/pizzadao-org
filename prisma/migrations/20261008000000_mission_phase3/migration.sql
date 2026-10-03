-- Mission verification, Phase 3 (plans/mission-verification.md §5.2, §5.3).
--
-- Additive only: five nullable columns and one new table, no data changes.
--   MissionCompletion.reviewMsgId      the Discord review card in #work
--   MissionCompletion.reviewChannelId  (message + channel, edited on decisions)
--   MissionCompletion.reviewCardAt     when the card was claimed / posted;
--                                      one card per review round (cleared on a
--                                      resubmission or a reopen)
--   MissionCompletion.reviewQueuedAt   when the row (re-)entered the human queue,
--                                      the 48 h SLA clock (NULL on older rows:
--                                      the app falls back to submittedAt)
--   MissionCompletion.slaNotifiedAt    last daily digest that listed it as overdue
--   MissionSlaDigest                   one row per UTC day the SLA digest was
--                                      posted (primary key = "at most once a day")
-- Safe to apply before the code that uses it is deployed.
--
-- Hand-written and verified on a throwaway local Postgres 17 built from
-- origin/main's schema with `prisma db push`: applied twice (the re-run is a
-- no-op), then `prisma migrate diff --from-config-datasource --to-schema
-- prisma/schema.prisma` came back empty. It has NOT been applied to Neon: run
-- `npx prisma migrate deploy` on a Neon branch first, then production, BEFORE
-- deploying the code that uses it.

-- AlterTable
ALTER TABLE "MissionCompletion" ADD COLUMN IF NOT EXISTS "reviewMsgId" TEXT;
ALTER TABLE "MissionCompletion" ADD COLUMN IF NOT EXISTS "reviewChannelId" TEXT;
ALTER TABLE "MissionCompletion" ADD COLUMN IF NOT EXISTS "reviewCardAt" TIMESTAMP(3);
ALTER TABLE "MissionCompletion" ADD COLUMN IF NOT EXISTS "reviewQueuedAt" TIMESTAMP(3);
ALTER TABLE "MissionCompletion" ADD COLUMN IF NOT EXISTS "slaNotifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE IF NOT EXISTS "MissionSlaDigest" (
    "day" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channelId" TEXT,
    "messageId" TEXT,
    "overdue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MissionSlaDigest_pkey" PRIMARY KEY ("day")
);
