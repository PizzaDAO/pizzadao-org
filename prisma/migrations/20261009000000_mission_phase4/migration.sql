-- Mission verification, Phase 4 (plans/mission-verification.md §2 L3.1, D4).
--
-- Additive only: one new table, no data changes, no column changes.
--   Referral   who invited whom (L3.1 "Invite a friend to Discord"): written
--              when the invitee completes onboarding, from the "Who invited
--              you?" step and/or a personal invite link (/join?ref=<memberId>).
--              One inviter per invitee (unique inviteeDiscordId); `flags` holds
--              the duplicate-account signals the invitee shares with the inviter.
-- Safe to apply before the code that uses it is deployed (nothing reads it yet).
--
-- NOT in this migration: "Migration B" (DROP COLUMN "Mission"."autoVerify").
-- The Phase 3 code running in production still selects that column (every
-- `include: { mission: true }`), so dropping it before this release is
-- deployed would break /missions. This release marks the field @ignore in
-- schema.prisma (the client no longer selects it); drop it in the NEXT
-- migration, after this release is live:
--   ALTER TABLE "Mission" DROP COLUMN IF EXISTS "autoVerify";
--
-- Hand-written and verified on a throwaway local Postgres 17 built from
-- origin/main's schema with `prisma db push`: applied twice (the re-run is a
-- no-op), then `prisma migrate diff --from-config-datasource --to-schema
-- prisma/schema.prisma` came back empty. It has NOT been applied to Neon: run
-- `npx prisma migrate deploy` on a Neon branch first, then production, BEFORE
-- deploying the code that uses it.

-- CreateTable
CREATE TABLE IF NOT EXISTS "Referral" (
    "id" SERIAL NOT NULL,
    "inviteeDiscordId" TEXT NOT NULL,
    "inviteeMemberId" TEXT,
    "inviterDiscordId" TEXT NOT NULL,
    "inviterMemberId" TEXT,
    "via" TEXT NOT NULL,
    "inviteCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "qualifiedAt" TIMESTAMP(3),
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Referral_inviteeDiscordId_key" ON "Referral"("inviteeDiscordId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Referral_inviterDiscordId_idx" ON "Referral"("inviterDiscordId");
