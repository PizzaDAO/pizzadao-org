-- Disavow list (plans/disavow-list.md). ADDITIVE ONLY: new enums, new tables,
-- new NotificationType values. Nothing existing is altered or dropped.
-- The new NotificationType values are not used anywhere in this migration.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DISAVOW_VOTE_NEEDED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DISAVOW_ROUND_CLOSED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'DISAVOW_LISTED_SUBJECT';

-- CreateEnum
CREATE TYPE "DisavowStatus" AS ENUM ('NOMINATED', 'LISTED', 'SUSPENDED', 'REJECTED', 'WITHDRAWN', 'REMOVED', 'EXPIRED');
CREATE TYPE "DisavowRoundKind" AS ENUM ('LIST', 'REMOVE', 'REAFFIRM');
CREATE TYPE "DisavowRoundState" AS ENUM ('OPEN', 'PASSED', 'FAILED', 'CANCELLED');
CREATE TYPE "DisavowVoteChoice" AS ENUM ('YES', 'NO', 'ABSTAIN', 'RECUSE');
CREATE TYPE "DisavowReason" AS ENUM ('SCAM', 'THEFT_OF_FUNDS', 'NON_DELIVERY', 'IMPERSONATION', 'HARASSMENT', 'OTHER');
CREATE TYPE "DisavowIdKind" AS ENUM ('MEMBER_ID', 'DISCORD_ID', 'X_HANDLE', 'WALLET', 'TELEGRAM', 'NAME');
CREATE TYPE "DisavowEventType" AS ENUM ('NOMINATED', 'VOTED', 'ROUND_OPENED', 'ROUND_CLOSED', 'LISTED', 'SUSPENDED', 'UNSUSPENDED', 'WITHDRAWN', 'REMOVED', 'EXPIRED', 'RESPONSE_ADDED', 'APPEALED', 'REDACTED', 'EDITED', 'VIEWED');

-- CreateTable
CREATE TABLE "Disavowal" (
    "id" TEXT NOT NULL,
    "status" "DisavowStatus" NOT NULL DEFAULT 'NOMINATED',
    "displayName" TEXT NOT NULL,
    "reason" "DisavowReason" NOT NULL,
    "statement" TEXT NOT NULL,
    "evidenceUrls" TEXT[],
    "nominatorDiscordId" TEXT NOT NULL,
    "subjectResponse" TEXT,
    "respondedAt" TIMESTAMP(3),
    "listedAt" TIMESTAMP(3),
    "reviewDueAt" TIMESTAMP(3),
    "lastAppealAt" TIMESTAMP(3),
    "redactedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Disavowal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DisavowIdentifier" (
    "id" SERIAL NOT NULL,
    "disavowalId" TEXT NOT NULL,
    "kind" "DisavowIdKind" NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "DisavowIdentifier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DisavowRound" (
    "id" TEXT NOT NULL,
    "disavowalId" TEXT NOT NULL,
    "kind" "DisavowRoundKind" NOT NULL,
    "state" "DisavowRoundState" NOT NULL DEFAULT 'OPEN',
    "openedBy" TEXT NOT NULL,
    "opensAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "DisavowRound_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DisavowVote" (
    "id" SERIAL NOT NULL,
    "roundId" TEXT NOT NULL,
    "voterDiscordId" TEXT NOT NULL,
    "choice" "DisavowVoteChoice" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisavowVote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DisavowEvent" (
    "id" SERIAL NOT NULL,
    "disavowalId" TEXT NOT NULL,
    "type" "DisavowEventType" NOT NULL,
    "actorDiscordId" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisavowEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Disavowal_status_idx" ON "Disavowal"("status");
CREATE INDEX "Disavowal_nominatorDiscordId_createdAt_idx" ON "Disavowal"("nominatorDiscordId", "createdAt");
CREATE INDEX "DisavowIdentifier_kind_value_idx" ON "DisavowIdentifier"("kind", "value");
CREATE UNIQUE INDEX "DisavowIdentifier_disavowalId_kind_value_key" ON "DisavowIdentifier"("disavowalId", "kind", "value");
CREATE INDEX "DisavowRound_disavowalId_state_idx" ON "DisavowRound"("disavowalId", "state");
CREATE INDEX "DisavowRound_state_closesAt_idx" ON "DisavowRound"("state", "closesAt");
CREATE UNIQUE INDEX "DisavowVote_roundId_voterDiscordId_key" ON "DisavowVote"("roundId", "voterDiscordId");
CREATE INDEX "DisavowEvent_disavowalId_createdAt_idx" ON "DisavowEvent"("disavowalId", "createdAt");

-- AddForeignKey (no cascades: nothing is ever deleted)
ALTER TABLE "DisavowIdentifier" ADD CONSTRAINT "DisavowIdentifier_disavowalId_fkey" FOREIGN KEY ("disavowalId") REFERENCES "Disavowal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DisavowRound" ADD CONSTRAINT "DisavowRound_disavowalId_fkey" FOREIGN KEY ("disavowalId") REFERENCES "Disavowal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DisavowVote" ADD CONSTRAINT "DisavowVote_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "DisavowRound"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DisavowEvent" ADD CONSTRAINT "DisavowEvent_disavowalId_fkey" FOREIGN KEY ("disavowalId") REFERENCES "Disavowal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- At most one OPEN round per disavowal, enforced by the database (Prisma cannot
-- model partial indexes, so this lives only in SQL).
CREATE UNIQUE INDEX "DisavowRound_one_open_per_disavowal" ON "DisavowRound"("disavowalId") WHERE "state" = 'OPEN';
