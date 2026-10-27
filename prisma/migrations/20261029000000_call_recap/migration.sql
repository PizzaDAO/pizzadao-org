-- Call recap: server-side transcription state + Discord recap bookkeeping (additive, nullable)
ALTER TABLE "CallRecording" ADD COLUMN "transcribedAt" TIMESTAMP(3);
ALTER TABLE "CallRecording" ADD COLUMN "transcribeError" TEXT;
ALTER TABLE "CallRecording" ADD COLUMN "recapPostedAt" TIMESTAMP(3);
ALTER TABLE "CallRecording" ADD COLUMN "recapChannelId" TEXT;
ALTER TABLE "CallRecording" ADD COLUMN "recapMessageId" TEXT;
