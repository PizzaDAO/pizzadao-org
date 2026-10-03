-- Mission verification, Phase 1 (plans/mission-verification.md §3.1, "Migration A").
--
-- Additive only: four new enums, three Mission columns, seven MissionCompletion
-- columns (all nullable or defaulted) and the MissionReviewEvent audit table.
-- Safe to apply before the code that uses it is deployed. NO data changes: the
-- per-mission verifier settings, the L1.0 reword and source='AUTO' for old
-- 'auto' approvals are set by scripts/missions/set-verifiers.mjs (dry run by
-- default), run separately after review.
--
-- Hand-written (`prisma migrate dev` can't replay the history: some production
-- tables predate the migrations folder) and verified on a throwaway local
-- Postgres 17 built from origin/main's schema with `prisma db push`: applied
-- there twice (the re-run is a no-op), then `prisma migrate diff
-- --from-config-datasource --to-schema prisma/schema.prisma` came back empty.
-- It has NOT been applied to Neon: run `npx prisma migrate deploy` on a Neon
-- branch first, then production, BEFORE deploying the code that uses it.
--
-- Every statement is guarded (IF NOT EXISTS / duplicate_object), so a re-run
-- is harmless. Not in this migration (later phases): Referral (Phase 4),
-- VerifierRun (Phase 2), Mission.reviewerRoleIds (Phase 0 put the L8 = DPR
-- rule in code), MissionCompletion.reviewMsgId (Phase 3 review cards).

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ProofKind" AS ENUM ('NONE', 'URL', 'DISCORD_MESSAGE', 'UPLOAD');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "CompletionSource" AS ENUM ('MANUAL', 'AUTO', 'SEMI');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "MissionHold" AS ENUM ('NEW_ACCOUNT', 'HIGH_LEVEL', 'PREVIOUSLY_REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ReviewAction" AS ENUM ('SUBMITTED', 'RESUBMITTED', 'AUTO_APPROVED', 'AUTO_HELD', 'RELEASED', 'APPROVED', 'REJECTED', 'REOPENED', 'FLAGGED', 'UNFLAGGED', 'NOTE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AlterTable
ALTER TABLE "Mission"
  ADD COLUMN IF NOT EXISTS "proofKind" "ProofKind" NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "verifierKey" TEXT,
  ADD COLUMN IF NOT EXISTS "verifierParams" JSONB;

-- AlterTable
ALTER TABLE "MissionCompletion"
  ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "checkResult" JSONB,
  ADD COLUMN IF NOT EXISTS "flagReason" TEXT,
  ADD COLUMN IF NOT EXISTS "flaggedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "holdReason" "MissionHold",
  ADD COLUMN IF NOT EXISTS "source" "CompletionSource" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE IF NOT EXISTS "MissionReviewEvent" (
    "id" SERIAL NOT NULL,
    "completionId" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" "ReviewAction" NOT NULL,
    "via" TEXT NOT NULL,
    "note" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MissionReviewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MissionReviewEvent_completionId_idx" ON "MissionReviewEvent"("completionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "MissionReviewEvent_actorId_createdAt_idx" ON "MissionReviewEvent"("actorId", "createdAt");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "MissionReviewEvent" ADD CONSTRAINT "MissionReviewEvent_completionId_fkey" FOREIGN KEY ("completionId") REFERENCES "MissionCompletion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
