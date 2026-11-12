-- CreateTable
CREATE TABLE "CrewSession" (
    "id" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "presenter" TEXT,
    "description" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "timeZone" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "eventId" TEXT,
    "announceMessageId" TEXT,
    "generalMessageId" TEXT,
    "telegramQueued" BOOLEAN NOT NULL DEFAULT false,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrewSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrewSession_crewId_dedupeKey_key" ON "CrewSession"("crewId", "dedupeKey");

-- CreateIndex
CREATE INDEX "CrewSession_crewId_startsAt_idx" ON "CrewSession"("crewId", "startsAt");
