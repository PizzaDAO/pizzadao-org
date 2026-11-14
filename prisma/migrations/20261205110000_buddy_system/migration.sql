-- Additive: buddy system phase 1 (manual matching). New tables only.

-- CreateTable
CREATE TABLE "BuddyProfile" (
    "discordId" TEXT NOT NULL,
    "memberId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxActive" INTEGER NOT NULL DEFAULT 2,
    "lastMatchedAt" TIMESTAMP(3),
    "addedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuddyProfile_pkey" PRIMARY KEY ("discordId")
);

-- CreateTable
CREATE TABLE "BuddyPair" (
    "id" TEXT NOT NULL,
    "traineeDiscordId" TEXT NOT NULL,
    "traineeMemberId" TEXT,
    "buddyDiscordId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "threadId" TEXT,
    "createdBy" TEXT,
    "introducedAt" TIMESTAMP(3),
    "firstHelloAt" TIMESTAMP(3),
    "vouchedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "endedReason" TEXT,
    "lastNudgeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuddyPair_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuddyEvent" (
    "id" TEXT NOT NULL,
    "pairId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data" JSONB,

    CONSTRAINT "BuddyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BuddyPair_buddyDiscordId_status_idx" ON "BuddyPair"("buddyDiscordId", "status");

-- CreateIndex
CREATE INDEX "BuddyPair_traineeDiscordId_idx" ON "BuddyPair"("traineeDiscordId");

-- CreateIndex
CREATE INDEX "BuddyEvent_pairId_kind_idx" ON "BuddyEvent"("pairId", "kind");

-- AddForeignKey
ALTER TABLE "BuddyEvent" ADD CONSTRAINT "BuddyEvent_pairId_fkey" FOREIGN KEY ("pairId") REFERENCES "BuddyPair"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One active buddy per trainee (Prisma cannot express a partial unique index).
CREATE UNIQUE INDEX "BuddyPair_one_active_per_trainee" ON "BuddyPair"("traineeDiscordId") WHERE "status" IN ('QUEUED', 'MATCHED', 'INTRODUCED');
