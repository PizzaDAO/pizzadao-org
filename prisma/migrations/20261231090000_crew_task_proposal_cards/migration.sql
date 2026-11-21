-- Task proposal cards: one bot card per proposed crew task update in the capo review channel.
-- Purely additive: one new table, nothing existing changes.

-- CreateTable
CREATE TABLE "CrewTaskProposalCard" (
    "proposalId" TEXT NOT NULL,
    "channelId" TEXT,
    "messageId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "renderedHash" VARCHAR(64),
    "resolvedAt" TIMESTAMP(3),
    "error" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrewTaskProposalCard_pkey" PRIMARY KEY ("proposalId")
);

-- AddForeignKey
ALTER TABLE "CrewTaskProposalCard" ADD CONSTRAINT "CrewTaskProposalCard_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "CrewTaskProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
