-- Live action items during calls (plans/post-call-agenda-updates.md, options A and C).
-- ADDITIVE ONLY: two new tables, no change to existing ones; re-runnable.
CREATE TABLE IF NOT EXISTS "CallLiveChunk" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "segments" JSONB NOT NULL,
    "audioMs" INTEGER NOT NULL DEFAULT 0,
    "segmentKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CallLiveChunk_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CallLiveChunk_sessionId_seq_key" ON "CallLiveChunk"("sessionId", "seq");
CREATE INDEX IF NOT EXISTS "CallLiveChunk_createdAt_idx" ON "CallLiveChunk"("createdAt");

CREATE TABLE IF NOT EXISTS "CallLiveItem" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "owner" TEXT,
    "normKey" TEXT NOT NULL,
    "speakerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "messageId" TEXT,
    "startMs" INTEGER,
    "endMs" INTEGER,
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CallLiveItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CallLiveItem_sessionId_normKey_key" ON "CallLiveItem"("sessionId", "normKey");
CREATE INDEX IF NOT EXISTS "CallLiveItem_createdAt_idx" ON "CallLiveItem"("createdAt");
