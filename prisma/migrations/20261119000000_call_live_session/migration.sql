-- Additive: the live state of a recorded call (heartbeat from the recorder).
CREATE TABLE "CallLiveSession" (
    "sessionId" TEXT NOT NULL,
    "eventId" TEXT,
    "eventName" TEXT,
    "crewId" TEXT,
    "crewLabel" TEXT,
    "channelId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "streamLink" TEXT,
    "presence" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallLiveSession_pkey" PRIMARY KEY ("sessionId")
);

CREATE INDEX "CallLiveSession_endedAt_lastSeenAt_idx" ON "CallLiveSession"("endedAt", "lastSeenAt");
