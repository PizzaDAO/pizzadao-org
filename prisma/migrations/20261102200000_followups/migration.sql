-- Follow-ups (metalhead-followups). ADDITIVE ONLY: new enums/tables and new columns with defaults or NULL; re-runnable.
DO $$ BEGIN
  CREATE TYPE "FollowUpStatus" AS ENUM ('DRAFT', 'APPROVED', 'SENT', 'FAILED', 'UNREACHABLE', 'ESCALATED', 'REPLIED', 'IN_PROGRESS', 'NEEDS_HELP', 'DONE', 'DISMISSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "FollowUpChannel" AS ENUM ('DISCORD', 'TELEGRAM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "TelegramAccount" ADD COLUMN IF NOT EXISTS "dmAllowed" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "CallRecording" ADD COLUMN IF NOT EXISTS "followupsDraftedAt" TIMESTAMP(3);
ALTER TABLE "CallRecording" ADD COLUMN IF NOT EXISTS "followupsAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CallRecording" ADD COLUMN IF NOT EXISTS "followupsError" TEXT;

CREATE TABLE IF NOT EXISTS "FollowUp" (
  "id" TEXT NOT NULL,
  "recordingId" TEXT,
  "sourceKey" TEXT NOT NULL,
  "ownerName" TEXT NOT NULL,
  "ownerDiscordId" TEXT,
  "ownerMemberId" TEXT,
  "candidates" JSONB,
  "kind" TEXT NOT NULL,
  "ask" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "quote" TEXT,
  "startMs" INTEGER,
  "dueAt" TIMESTAMP(3),
  "dueText" TEXT,
  "status" "FollowUpStatus" NOT NULL DEFAULT 'DRAFT',
  "channel" "FollowUpChannel",
  "escalateOnly" BOOLEAN NOT NULL DEFAULT false,
  "sendAfter" TIMESTAMP(3),
  "sendAttemptAt" TIMESTAMP(3),
  "discordChannelId" TEXT,
  "discordMessageId" TEXT,
  "telegramChatId" TEXT,
  "telegramMessageId" INTEGER,
  "lastReply" TEXT,
  "lastReplyAt" TIMESTAMP(3),
  "approvedBy" TEXT,
  "approvedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "escalatedAt" TIMESTAMP(3),
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FollowUp_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "FollowUpEvent" (
  "id" SERIAL NOT NULL,
  "followUpId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "actorId" TEXT,
  "data" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FollowUpEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MessagingOptOut" (
  "discordId" TEXT NOT NULL,
  "scope" TEXT NOT NULL DEFAULT 'followups',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MessagingOptOut_pkey" PRIMARY KEY ("discordId")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FollowUp_sourceKey_key" ON "FollowUp"("sourceKey");
CREATE INDEX IF NOT EXISTS "FollowUp_status_sendAfter_idx" ON "FollowUp"("status", "sendAfter");
CREATE INDEX IF NOT EXISTS "FollowUp_ownerDiscordId_sentAt_idx" ON "FollowUp"("ownerDiscordId", "sentAt");
CREATE INDEX IF NOT EXISTS "FollowUp_recordingId_idx" ON "FollowUp"("recordingId");
CREATE INDEX IF NOT EXISTS "FollowUp_telegramChatId_telegramMessageId_idx" ON "FollowUp"("telegramChatId", "telegramMessageId");
CREATE INDEX IF NOT EXISTS "FollowUpEvent_followUpId_createdAt_idx" ON "FollowUpEvent"("followUpId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "FollowUpEvent" ADD CONSTRAINT "FollowUpEvent_followUpId_fkey" FOREIGN KEY ("followUpId") REFERENCES "FollowUp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
