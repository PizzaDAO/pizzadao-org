-- Mission verification, Phase 2 (plans/mission-verification.md §3.1, §6.2, §7).
--
-- Additive only: two new tables, no data changes.
--   VerifierRun    one row per nightly run (/api/cron/missions) or backfill
--                  (scripts/missions/backfill.mjs): resume cursor, lease, stats.
--   AccountSignal  duplicate-account signals (shared wallet / X / Telegram /
--                  memberId, members-sheet duplicates), recomputed nightly and
--                  shown to reviewers. Flags only: nothing is blocked or revoked.
-- Safe to apply before the code that uses it is deployed.
--
-- NOT in this migration: "Migration B" (DROP COLUMN "Mission"."autoVerify").
-- It is deferred to the next release: the Phase 1 code running in production
-- (Prisma selects every Mission column), scripts/missions/set-verifiers.mjs,
-- the seed scripts and the concurrency suite still read or write the column,
-- so dropping it before this release is live would break production. This
-- release removes the app's remaining reads; the next one drops the column.
--
-- Hand-written and verified on a throwaway local Postgres 17 built from
-- origin/main's schema with `prisma db push`: applied twice (the re-run is a
-- no-op), then `prisma migrate diff --from-config-datasource --to-schema
-- prisma/schema.prisma` came back empty. It has NOT been applied to Neon: run
-- `npx prisma migrate deploy` on a Neon branch first, then production, BEFORE
-- deploying the code that uses it.

-- CreateTable
CREATE TABLE IF NOT EXISTS "VerifierRun" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "dryRun" BOOLEAN NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "cursor" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "stats" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerifierRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "VerifierRun_kind_startedAt_idx" ON "VerifierRun"("kind", "startedAt");

-- CreateTable
CREATE TABLE IF NOT EXISTS "AccountSignal" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "discordIds" TEXT[],
    "memberIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "detail" JSONB,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AccountSignal_kind_key_key" ON "AccountSignal"("kind", "key");
