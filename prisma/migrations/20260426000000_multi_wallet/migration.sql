-- Multi-wallet migration: convert single-wallet MemberWallet to multi-wallet
-- Strategy: rename old table, create new with autoincrement PK, copy rows, drop old

-- 1. Rename existing table
ALTER TABLE "MemberWallet" RENAME TO "MemberWallet_old";

-- 2. Create new table with autoincrement PK and multi-wallet fields
CREATE TABLE "MemberWallet" (
    "id" SERIAL NOT NULL,
    "memberId" TEXT NOT NULL,
    "discordId" TEXT,
    "walletAddress" TEXT NOT NULL,
    "label" TEXT,
    "chainType" TEXT NOT NULL DEFAULT 'evm',
    "source" TEXT NOT NULL DEFAULT 'sheet',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberWallet_pkey" PRIMARY KEY ("id")
);

-- 3. Copy existing rows with isPrimary = true (all existing wallets become primary)
INSERT INTO "MemberWallet" ("memberId", "discordId", "walletAddress", "source", "isPrimary", "createdAt", "updatedAt")
SELECT "memberId", "discordId", "walletAddress", "source", true, "createdAt", "updatedAt"
FROM "MemberWallet_old";

-- 4. Drop old table
DROP TABLE "MemberWallet_old";

-- 5. Create unique constraint and indexes
CREATE UNIQUE INDEX "MemberWallet_memberId_walletAddress_key" ON "MemberWallet"("memberId", "walletAddress");
CREATE INDEX "MemberWallet_memberId_idx" ON "MemberWallet"("memberId");
CREATE INDEX "MemberWallet_walletAddress_idx" ON "MemberWallet"("walletAddress");
