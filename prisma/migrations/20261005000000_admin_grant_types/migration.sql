-- Admin money commands (/add-money, /remove-money):
-- two new TransactionType values for the admin ledger rows.
--
-- Additive only. Depends on 20261004000000_pep_discord_economy being applied
-- first. Hand-written (`prisma migrate dev` can't replay the history: some
-- production tables predate the migrations folder) and verified on a throwaway
-- local Postgres 17 built from origin/main's schema with `prisma db push`:
-- applied there (twice, to check the re-run is a no-op), then
-- `prisma migrate diff` against schema.prisma came back empty. It has NOT been
-- applied to Neon: run `npx prisma migrate deploy` on a Neon branch first, then
-- production, BEFORE deploying the code that uses it.
--
-- IF NOT EXISTS makes a re-run harmless. A new enum value can't be used in the
-- transaction that adds it, which is fine: nothing here uses it.

ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'ADMIN_GRANT';
ALTER TYPE "TransactionType" ADD VALUE IF NOT EXISTS 'ADMIN_REMOVE';
