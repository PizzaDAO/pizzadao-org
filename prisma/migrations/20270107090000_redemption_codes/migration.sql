-- Proof of Pizza redemption codes (plans/proof-of-pizza-codes.md). Additive only: one enum, one table.

-- CreateEnum
CREATE TYPE "RedemptionCodeStatus" AS ENUM ('ACTIVE', 'REDEEMED', 'VOID');

-- CreateTable
CREATE TABLE "RedemptionCode" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "itemId" INTEGER NOT NULL,
    "discordId" TEXT NOT NULL,
    "status" "RedemptionCodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedAt" TIMESTAMP(3),
    "redeemedRef" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "dmSentAt" TIMESTAMP(3),

    CONSTRAINT "RedemptionCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RedemptionCode_code_key" ON "RedemptionCode"("code");

-- CreateIndex
CREATE UNIQUE INDEX "RedemptionCode_redeemedRef_key" ON "RedemptionCode"("redeemedRef");

-- CreateIndex
CREATE INDEX "RedemptionCode_discordId_itemId_status_idx" ON "RedemptionCode"("discordId", "itemId", "status");
