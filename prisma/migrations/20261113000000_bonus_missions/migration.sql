-- Bonus missions: optional missions that never gate a level (and level 0 = "Anytime").
-- ADDITIVE ONLY: two new columns with defaults; existing rows stay required (bonus = false). Re-runnable.
ALTER TABLE "Mission" ADD COLUMN IF NOT EXISTS "bonus" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Mission" ADD COLUMN IF NOT EXISTS "bonusReward" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Mission" ADD COLUMN IF NOT EXISTS "bonusRewardSetAt" TIMESTAMP(3);
