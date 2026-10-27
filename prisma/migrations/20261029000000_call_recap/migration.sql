-- Call recap: server-side transcription state + Discord recap bookkeeping (additive, nullable)
ALTER TABLE "CallRecording" ADD COLUMN "transcribedAt" TIMESTAMP(3);
ALTER TABLE "CallRecording" ADD COLUMN "transcribeError" TEXT;
ALTER TABLE "CallRecording" ADD COLUMN "recapPostedAt" TIMESTAMP(3);
ALTER TABLE "CallRecording" ADD COLUMN "recapChannelId" TEXT;
ALTER TABLE "CallRecording" ADD COLUMN "recapMessageId" TEXT;
ALTER TABLE "CallRecording" ADD COLUMN "recapError" TEXT;
ALTER TABLE "CallRecording" ADD COLUMN "transcribeAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CallRecording" ADD COLUMN "transcribeTracks" JSONB;
ALTER TABLE "CallRecording" ADD COLUMN "summaryGeneratedAt" TIMESTAMP(3);
ALTER TABLE "CallRecording" ADD COLUMN "summaryEditedAt" TIMESTAMP(3);
ALTER TABLE "CallRecording" ADD COLUMN "redactionsUpdatedAt" TIMESTAMP(3);
