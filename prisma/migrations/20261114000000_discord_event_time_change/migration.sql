-- DST sync of crew call times (plans/dst-crew-call-times.md): change log for Discord scheduled event start times.
-- ADDITIVE ONLY: one new table, no change to existing ones; re-runnable.
CREATE TABLE IF NOT EXISTS "DiscordEventTimeChange" (
    "id" SERIAL NOT NULL,
    "runId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL DEFAULT '',
    "timeZone" TEXT NOT NULL,
    "intendedLocal" TEXT NOT NULL,
    "oldStart" TIMESTAMP(3) NOT NULL,
    "newStart" TIMESTAMP(3),
    "action" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiscordEventTimeChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DiscordEventTimeChange_eventId_createdAt_idx" ON "DiscordEventTimeChange"("eventId", "createdAt");
CREATE INDEX IF NOT EXISTS "DiscordEventTimeChange_createdAt_idx" ON "DiscordEventTimeChange"("createdAt");
