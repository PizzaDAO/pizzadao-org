-- Plan: stuffed-crust-39669 (activity feed completeness).
-- Adds persisted timestamps for the three deferred activity kinds:
-- task_claimed, poap_received, role_granted. Additive only — no ALTERs.

-- CreateTable
CREATE TABLE IF NOT EXISTS "TaskClaimEvent" (
    "id"        SERIAL NOT NULL,
    "memberId"  TEXT NOT NULL,
    "taskKey"   TEXT NOT NULL,
    "taskName"  TEXT NOT NULL,
    "sheetUrl"  TEXT,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskClaimEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TaskClaimEvent_memberId_taskKey_key"
    ON "TaskClaimEvent"("memberId", "taskKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TaskClaimEvent_memberId_claimedAt_idx"
    ON "TaskClaimEvent"("memberId", "claimedAt");

-- CreateTable
CREATE TABLE IF NOT EXISTS "PoapFirstSeen" (
    "id"          SERIAL NOT NULL,
    "memberId"    TEXT NOT NULL,
    "poapEventId" TEXT NOT NULL,
    "poapTokenId" TEXT NOT NULL,
    "title"       TEXT,
    "imageUrl"    TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoapFirstSeen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PoapFirstSeen_memberId_poapEventId_key"
    ON "PoapFirstSeen"("memberId", "poapEventId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PoapFirstSeen_memberId_firstSeenAt_idx"
    ON "PoapFirstSeen"("memberId", "firstSeenAt");

-- CreateTable
CREATE TABLE IF NOT EXISTS "RoleGrantEvent" (
    "id"        SERIAL NOT NULL,
    "memberId"  TEXT,
    "discordId" TEXT NOT NULL,
    "roleId"    TEXT NOT NULL,
    "roleName"  TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleGrantEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "RoleGrantEvent_discordId_roleId_key"
    ON "RoleGrantEvent"("discordId", "roleId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RoleGrantEvent_discordId_grantedAt_idx"
    ON "RoleGrantEvent"("discordId", "grantedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RoleGrantEvent_memberId_grantedAt_idx"
    ON "RoleGrantEvent"("memberId", "grantedAt");
