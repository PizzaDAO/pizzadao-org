-- Plan: diavola-40350 (First-Time User Celebration Loop)
-- Extend MemberProfileExtras with celebration tracking. Additive only.

ALTER TABLE "MemberProfileExtras"
  ADD COLUMN IF NOT EXISTS "lastCelebratedLevel" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "MemberProfileExtras"
  ADD COLUMN IF NOT EXISTS "firstMissionCelebratedAt" TIMESTAMP(3);

ALTER TABLE "MemberProfileExtras"
  ADD COLUMN IF NOT EXISTS "vouchPromptShownAt" TIMESTAMP(3);
