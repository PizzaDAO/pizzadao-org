-- Idempotency record for the pre-call agenda cron. ADDITIVE ONLY (one new table); re-runnable.
CREATE TABLE IF NOT EXISTS "CallAgendaPost" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "crewId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "messageId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CallAgendaPost_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CallAgendaPost_eventId_startsAt_key" ON "CallAgendaPost"("eventId", "startsAt");
CREATE INDEX IF NOT EXISTS "CallAgendaPost_crewId_startsAt_idx" ON "CallAgendaPost"("crewId", "startsAt");
