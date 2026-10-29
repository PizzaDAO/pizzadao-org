-- Disavow rounds remember the rules they opened under. ADDITIVE ONLY (two nullable columns);
-- re-runnable. NULL means "opened before this existed": the round keeps the code defaults
-- (3 yes votes, 7 days), which is what it was opened under, so open rounds are unchanged.
ALTER TABLE "DisavowRound" ADD COLUMN IF NOT EXISTS "yesThreshold" INTEGER;
ALTER TABLE "DisavowRound" ADD COLUMN IF NOT EXISTS "decisionDays" INTEGER;
