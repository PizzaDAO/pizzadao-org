-- CreateTable
CREATE TABLE "CallUpdatesRun" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "eventId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "crewId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "reason" TEXT,
    "scriptHash" TEXT,
    "sectionCount" INTEGER,
    "estSeconds" INTEGER,
    "startedBy" TEXT,
    "controlledBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallUpdatesRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CallUpdatesRun_sessionId_seq_key" ON "CallUpdatesRun"("sessionId", "seq");

-- CreateIndex
CREATE INDEX "CallUpdatesRun_eventId_startsAt_idx" ON "CallUpdatesRun"("eventId", "startsAt");

-- CreateIndex
CREATE INDEX "CallUpdatesRun_crewId_createdAt_idx" ON "CallUpdatesRun"("crewId", "createdAt");
