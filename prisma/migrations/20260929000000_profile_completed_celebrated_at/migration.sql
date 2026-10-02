-- Plan: jalapeno-34126 (profile-complete celebration).
-- Adds a one-shot flag for the "your profile is complete" celebration and
-- grandfathers existing members so the pop-up doesn't fire for everyone who
-- was already set up on the day this ships.

-- 1. Additive column (nullable, no default => existing rows read as "not yet celebrated").
ALTER TABLE "MemberProfileExtras"
  ADD COLUMN IF NOT EXISTS "profileCompletedCelebratedAt" TIMESTAMP(3);

-- 2. Backfill: stamp members whose profile is already complete.
--
-- Profile steps (app/dashboard/[id]/lib/profile-completion.ts):
--   join_crew       — "Crews" cell in the Google Sheet  (NOT in Postgres)
--   connect_wallet  — >=1 row in "MemberWallet"
--   connect_x       — a row in "XAccount" with that memberId
--
-- Only wallet + X are visible to SQL, so this approximates "complete" as
-- "has a wallet AND a connected X account". The steps are ranked crew ->
-- wallet -> X, so almost everyone who got that far already joined a crew.
-- The trade-off: a member with wallet + X but no crew today will not get the
-- pop-up when they later join one (the meter still works for them). That's
-- preferable to showing an unearned "just completed!" pop-up to every
-- established member at deploy time.
--
-- Rows may not exist yet for every member (MemberProfileExtras is lazily
-- created), so upsert. "updatedAt" has no DB default (Prisma @updatedAt).
-- Idempotent: re-running never overwrites an existing timestamp.
INSERT INTO "MemberProfileExtras" ("memberId", "profileCompletedCelebratedAt", "updatedAt")
SELECT DISTINCT w."memberId", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "MemberWallet" w
JOIN "XAccount" x ON x."memberId" = w."memberId"
WHERE w."memberId" <> ''
ON CONFLICT ("memberId") DO UPDATE
  SET "profileCompletedCelebratedAt" = COALESCE(
    "MemberProfileExtras"."profileCompletedCelebratedAt",
    EXCLUDED."profileCompletedCelebratedAt"
  );
