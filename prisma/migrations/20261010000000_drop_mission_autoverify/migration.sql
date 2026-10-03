-- Mission verification, Phase 5: "Migration B" (plans/mission-verification.md §8).
--
-- Drops the legacy Mission."autoVerify" flag. It was replaced by
-- Mission."verifierKey" in Phase 1, ignored by the submit path since Phase 0,
-- and marked @ignore in schema.prisma in Phase 4 (the deployed client never
-- selects it). No app code, script or test reads or writes it any more.
--
-- Idempotent: IF EXISTS makes a re-run a no-op.
--
-- Hand-written and verified on a throwaway local Postgres 17 built from
-- origin/main's schema with `prisma db push` (column present, one Mission row):
-- applied twice (the re-run is a no-op NOTICE), then `prisma migrate diff
-- --from-config-datasource --to-schema prisma/schema.prisma` came back empty. It has NOT been applied to Neon: run
-- `npx prisma migrate deploy` on a Neon branch first, then production. Order
-- does not matter for this one (the deployed Phase 4 code doesn't select the
-- column), but applying it before or with this release's deploy is simplest.

ALTER TABLE "Mission" DROP COLUMN IF EXISTS "autoVerify";
