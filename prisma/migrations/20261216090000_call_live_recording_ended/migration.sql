-- Additive: when a live call's recording stopped (its limit) while the call itself went on.
ALTER TABLE "CallLiveSession" ADD COLUMN IF NOT EXISTS "recordingEndedAt" TIMESTAMP(3);
