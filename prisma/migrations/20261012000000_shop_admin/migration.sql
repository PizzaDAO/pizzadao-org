-- Shop admin page (/admin/shop): audit log for every admin change to the shop.
--
--   * ShopAdminAction enum + ShopAdminEvent table: actor, action, item (id +
--     name snapshot, no FK so a row survives a hard delete), target member,
--     quantity, before/after JSON, reason, timestamp.
--
-- Admin grants reuse the existing ItemGrant table (source 'admin'); nothing
-- about ShopItem, Inventory or ItemGrant changes.
--
-- ADDITIVE ONLY and hand-written to be re-runnable (guarded enum creation,
-- IF NOT EXISTS on the table and indexes): no drops, no renames, no change to
-- existing data.
--
-- Validated on a throwaway local Postgres 17 built from origin/main's schema
-- with `prisma db push`: applied, re-applied as a no-op, and
-- `prisma migrate diff --from-config-datasource --to-schema` is empty.
-- NOT applied to Neon: run `npx prisma migrate deploy` on a Neon branch, then
-- production, BEFORE deploying the code that uses it.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ShopAdminAction" AS ENUM ('CREATE', 'UPDATE', 'HIDE', 'SHOW', 'DELETE', 'RESTOCK', 'ADJUST_STOCK', 'GRANT', 'REMOVE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ShopAdminEvent" (
    "id" SERIAL NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" "ShopAdminAction" NOT NULL,
    "itemId" INTEGER,
    "itemName" TEXT NOT NULL,
    "targetId" TEXT,
    "quantity" INTEGER,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopAdminEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ShopAdminEvent_createdAt_idx" ON "ShopAdminEvent"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ShopAdminEvent_itemId_createdAt_idx" ON "ShopAdminEvent"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ShopAdminEvent_targetId_idx" ON "ShopAdminEvent"("targetId");
