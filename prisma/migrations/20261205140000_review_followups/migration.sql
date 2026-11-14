-- Additive: review follow-ups (buddy removal marker + intro claim; education channel ids + update-note claim). Nullable columns only.
ALTER TABLE "BuddyProfile" ADD COLUMN "removedAt" TIMESTAMP(3);
ALTER TABLE "BuddyPair" ADD COLUMN "introStartedAt" TIMESTAMP(3);
ALTER TABLE "CrewSession" ADD COLUMN "announceChannelId" TEXT;
ALTER TABLE "CrewSession" ADD COLUMN "generalChannelId" TEXT;
ALTER TABLE "CrewSession" ADD COLUMN "noteKey" TEXT;
