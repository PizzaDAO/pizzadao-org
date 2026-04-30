-- CreateTable
CREATE TABLE "UnlockTicketClaim" (
    "id" SERIAL NOT NULL,
    "discordId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "ticketCount" INTEGER NOT NULL,
    "pointsAwarded" INTEGER NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnlockTicketClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnlockTicketRecord" (
    "id" SERIAL NOT NULL,
    "claimId" INTEGER NOT NULL,
    "lockAddress" TEXT NOT NULL,
    "networkId" INTEGER NOT NULL,
    "eventName" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,

    CONSTRAINT "UnlockTicketRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UnlockTicketClaim_discordId_key" ON "UnlockTicketClaim"("discordId");

-- CreateIndex
CREATE UNIQUE INDEX "UnlockTicketClaim_walletAddress_key" ON "UnlockTicketClaim"("walletAddress");

-- CreateIndex
CREATE INDEX "UnlockTicketClaim_memberId_idx" ON "UnlockTicketClaim"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "UnlockTicketRecord_lockAddress_tokenId_networkId_key" ON "UnlockTicketRecord"("lockAddress", "tokenId", "networkId");

-- AddForeignKey
ALTER TABLE "UnlockTicketClaim" ADD CONSTRAINT "UnlockTicketClaim_discordId_fkey" FOREIGN KEY ("discordId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnlockTicketRecord" ADD CONSTRAINT "UnlockTicketRecord_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "UnlockTicketClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
