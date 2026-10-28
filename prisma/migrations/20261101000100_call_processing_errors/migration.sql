-- Call processing diagnostics. ADDITIVE ONLY (four nullable/defaulted columns); re-runnable.
ALTER TABLE "CallRecording" ADD COLUMN IF NOT EXISTS "summaryError" TEXT;
ALTER TABLE "CallRecording" ADD COLUMN IF NOT EXISTS "summaryAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CallRecording" ADD COLUMN IF NOT EXISTS "transcribeStats" JSONB;
ALTER TABLE "CallRecording" ADD COLUMN IF NOT EXISTS "retranscribeRequestedAt" TIMESTAMP(3);
