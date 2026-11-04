-- Proposed crew task updates from a call (plans/post-call-agenda-updates.md, ask 2).
-- ADDITIVE ONLY: one new table plus nullable/defaulted columns on CallRecording; re-runnable.
CREATE TABLE IF NOT EXISTS "CrewTaskProposal" (
    "id" TEXT NOT NULL,
    "recordingId" TEXT NOT NULL,
    "crewId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "taskId" TEXT,
    "baseUpdatedAt" TIMESTAMP(3),
    "changes" JSONB NOT NULL,
    "edited" JSONB,
    "leadName" TEXT,
    "leadMemberId" TEXT,
    "candidates" JSONB,
    "reason" TEXT NOT NULL,
    "quote" TEXT,
    "startMs" INTEGER,
    "confidence" TEXT NOT NULL,
    "actionItemIdx" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CrewTaskProposal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CrewTaskProposal_sourceKey_key" ON "CrewTaskProposal"("sourceKey");
CREATE INDEX IF NOT EXISTS "CrewTaskProposal_crewId_status_createdAt_idx" ON "CrewTaskProposal"("crewId", "status", "createdAt");
CREATE INDEX IF NOT EXISTS "CrewTaskProposal_recordingId_idx" ON "CrewTaskProposal"("recordingId");

ALTER TABLE "CallRecording" ADD COLUMN IF NOT EXISTS "taskProposalsAt" TIMESTAMP(3);
ALTER TABLE "CallRecording" ADD COLUMN IF NOT EXISTS "taskProposalsAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CallRecording" ADD COLUMN IF NOT EXISTS "taskProposalsError" TEXT;
ALTER TABLE "CallRecording" ADD COLUMN IF NOT EXISTS "taskProposalsNudgedAt" TIMESTAMP(3);
