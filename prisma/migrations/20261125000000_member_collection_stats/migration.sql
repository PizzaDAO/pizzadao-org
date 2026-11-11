-- Nightly precomputed collection counts per member (POAPs, NFTs, tickets) so the profile
-- does not wait on Alchemy/POAP calls. Additive only.
CREATE TABLE "MemberCollectionStats" (
    "memberId" TEXT NOT NULL,
    "poapCount" INTEGER NOT NULL DEFAULT 0,
    "nftCount" INTEGER NOT NULL DEFAULT 0,
    "nftCollections" INTEGER NOT NULL DEFAULT 0,
    "ticketCount" INTEGER NOT NULL DEFAULT 0,
    "hasWallet" BOOLEAN NOT NULL DEFAULT false,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberCollectionStats_pkey" PRIMARY KEY ("memberId")
);

CREATE INDEX "MemberCollectionStats_computedAt_idx" ON "MemberCollectionStats"("computedAt");
