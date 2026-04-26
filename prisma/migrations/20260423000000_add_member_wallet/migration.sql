-- CreateTable
CREATE TABLE "MemberWallet" (
    "memberId" TEXT NOT NULL,
    "discordId" TEXT,
    "walletAddress" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'sheet',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberWallet_pkey" PRIMARY KEY ("memberId")
);

-- CreateIndex
CREATE INDEX "MemberWallet_walletAddress_idx" ON "MemberWallet"("walletAddress");
