-- Action-item status in call recaps. Additive: nullable columns and indexes only.
ALTER TABLE "FollowUp" ADD COLUMN "actionKey" VARCHAR(16), ADD COLUMN "doneUrl" VARCHAR(500), ADD COLUMN "doneUrlAt" TIMESTAMP(3), ADD COLUMN "doneUrlBy" TEXT;
CREATE INDEX "FollowUp_recordingId_actionKey_idx" ON "FollowUp"("recordingId", "actionKey");
ALTER TABLE "CallRecording" ADD COLUMN "recapRefreshAt" TIMESTAMP(3), ADD COLUMN "recapEditedAt" TIMESTAMP(3), ADD COLUMN "recapRenderedHash" VARCHAR(64);
CREATE INDEX "CallRecording_recapRefreshAt_idx" ON "CallRecording"("recapRefreshAt");
