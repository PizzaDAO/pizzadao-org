-- calzone-30418: hide single transcript lines (chat messages). ADDITIVE ONLY; re-runnable.
ALTER TABLE "CallRecording" ADD COLUMN IF NOT EXISTS "redactedSegmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
