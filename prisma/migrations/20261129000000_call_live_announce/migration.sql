-- Additive: one row per "we're live" announcement (idempotency claim + the Discord message to edit).
CREATE TABLE "CallLiveAnnounce" (
    "occurrenceKey" TEXT NOT NULL,
    "eventId" TEXT,
    "sessionId" TEXT,
    "voiceChannelId" TEXT,
    "postedChannelId" TEXT,
    "discordMessageId" TEXT,
    "streamLink" TEXT,
    "source" VARCHAR(12) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "reminderDueAt" TIMESTAMP(3) NOT NULL,
    "reminderQueuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallLiveAnnounce_pkey" PRIMARY KEY ("occurrenceKey")
);

CREATE INDEX "CallLiveAnnounce_reminderQueuedAt_reminderDueAt_idx" ON "CallLiveAnnounce"("reminderQueuedAt", "reminderDueAt");
