-- UnbelievaBoat item carry-over: collectibles + pending item grants.
--
--   * ShopItem.isCollectible: an item that can be held (granted, shown in
--     inventories) but never bought, and that the shop-sheet sync never
--     deactivates or updates (e.g. the retired Molto Benny Pin).
--   * ItemGrant.status / creditedAt: a grant for a member with no app account
--     (no User row) is stored PENDING and credited into Inventory on their
--     first login / onboarding. Existing rows were credited when they were
--     written, so they default to CREDITED and creditedAt is backfilled.
--
-- ADDITIVE ONLY and hand-written to be re-runnable (IF NOT EXISTS, guarded
-- enum creation, idempotent backfill): no drops, no renames, no change to
-- existing data beyond filling the new nullable creditedAt column.
--
-- Validated on a throwaway local Postgres 17 built from origin/main's schema
-- with `prisma db push`: applied, re-applied as a no-op, and
-- `prisma migrate diff --from-config-datasource --to-schema` is empty.
-- NOT applied to Neon: run `npx prisma migrate deploy` on a Neon branch, then
-- production, BEFORE deploying the code that uses it.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ItemGrantStatus" AS ENUM ('PENDING', 'CREDITED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "ShopItem" ADD COLUMN IF NOT EXISTS "isCollectible" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ItemGrant" ADD COLUMN IF NOT EXISTS "status" "ItemGrantStatus" NOT NULL DEFAULT 'CREDITED';
ALTER TABLE "ItemGrant" ADD COLUMN IF NOT EXISTS "creditedAt" TIMESTAMP(3);

-- Backfill: grants written before this migration went straight into Inventory.
UPDATE "ItemGrant" SET "creditedAt" = "createdAt" WHERE "status" = 'CREDITED' AND "creditedAt" IS NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ItemGrant_discordId_status_idx" ON "ItemGrant"("discordId", "status");
