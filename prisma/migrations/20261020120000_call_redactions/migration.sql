-- calzone-30418: non-destructive transcript redaction. ADDITIVE ONLY; re-runnable.
ALTER TABLE "CallRecording" ADD COLUMN IF NOT EXISTS "redactedSpeakerIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
