-- Additive: one row per crew call started from the crew page (the claim that stops a double start).
CREATE TABLE IF NOT EXISTS "CrewCallStart" (
    "occurrenceKey" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "eventId" TEXT,
    "adHoc" BOOLEAN NOT NULL DEFAULT false,
    "channelId" TEXT,
    "startedBy" TEXT NOT NULL,
    "postMessageId" TEXT,
    "error" VARCHAR(300),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrewCallStart_pkey" PRIMARY KEY ("occurrenceKey")
);

CREATE INDEX IF NOT EXISTS "CrewCallStart_crewId_createdAt_idx" ON "CrewCallStart"("crewId", "createdAt");
