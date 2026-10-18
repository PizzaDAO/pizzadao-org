-- calzone-30418: call recorder (Phase 1). ADDITIVE ONLY; re-runnable.
DO $$ BEGIN
    CREATE TYPE "CallRecordingStatus" AS ENUM ('RECORDED', 'PROCESSING', 'IN_REVIEW', 'PUBLISHED', 'REJECTED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "CallRecording" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "status" "CallRecordingStatus" NOT NULL DEFAULT 'RECORDED',
    "discordEventId" TEXT,
    "eventName" TEXT,
    "crewId" TEXT,
    "crewLabel" TEXT,
    "channelId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "endReason" TEXT,
    "partial" BOOLEAN NOT NULL DEFAULT false,
    "mixKey" TEXT,
    "mixBytes" INTEGER,
    "audioDeletedAt" TIMESTAMP(3),
    "title" TEXT,
    "transcript" JSONB,
    "transcriptLanguage" TEXT,
    "summary" TEXT,
    "actionItems" JSONB,
    "chapters" JSONB,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallRecording_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CallSpeaker" (
    "id" SERIAL NOT NULL,
    "recordingId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "displayName" TEXT,
    "talkTimeSec" INTEGER NOT NULL DEFAULT 0,
    "trackKey" TEXT,
    "trackBytes" INTEGER,

    CONSTRAINT "CallSpeaker_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "RecordingOptOut" (
    "discordId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordingOptOut_pkey" PRIMARY KEY ("discordId")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CallRecording_sessionId_key" ON "CallRecording"("sessionId");
CREATE INDEX IF NOT EXISTS "CallRecording_status_startedAt_idx" ON "CallRecording"("status", "startedAt");
CREATE INDEX IF NOT EXISTS "CallRecording_crewId_startedAt_idx" ON "CallRecording"("crewId", "startedAt");
CREATE INDEX IF NOT EXISTS "CallRecording_createdAt_idx" ON "CallRecording"("createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "CallSpeaker_recordingId_discordId_key" ON "CallSpeaker"("recordingId", "discordId");
CREATE INDEX IF NOT EXISTS "CallSpeaker_discordId_idx" ON "CallSpeaker"("discordId");

DO $$ BEGIN
    ALTER TABLE "CallSpeaker" ADD CONSTRAINT "CallSpeaker_recordingId_fkey"
        FOREIGN KEY ("recordingId") REFERENCES "CallRecording"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
