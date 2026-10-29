-- CreateEnum
CREATE TYPE "ProposalKind" AS ENUM ('FUNDING', 'GENERAL');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'OPEN', 'PASSED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProposalChoice" AS ENUM ('AYE', 'NAY', 'ABSTAIN');

-- AlterTable
ALTER TABLE "PaymentRequest" ADD COLUMN     "proposalId" TEXT;

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "kind" "ProposalKind" NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "amountUsdCents" INTEGER,
    "eventDate" TIMESTAMP(3),
    "city" TEXT,
    "proposerDiscordId" TEXT NOT NULL,
    "sponsorLabel" TEXT,
    "opensAt" TIMESTAMP(3),
    "closesAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "ayesNeeded" INTEGER,
    "countAbstains" BOOLEAN NOT NULL DEFAULT true,
    "requireAyesOverNays" BOOLEAN NOT NULL DEFAULT true,
    "eligibleCount" INTEGER,
    "voterRoleId" TEXT,
    "keyPublicPem" TEXT,
    "keyFingerprint" TEXT,
    "keyPrivateEnc" TEXT,
    "ayes" INTEGER NOT NULL DEFAULT 0,
    "nays" INTEGER NOT NULL DEFAULT 0,
    "abstains" INTEGER NOT NULL DEFAULT 0,
    "discordChannelId" TEXT,
    "discordMessageId" TEXT,
    "resultPostedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalVoter" (
    "proposalId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "tokenIssuedAt" TIMESTAMP(3),
    "ballotBlob" TEXT,

    CONSTRAINT "ProposalVoter_pkey" PRIMARY KEY ("proposalId","discordId")
);

-- CreateTable
CREATE TABLE "ProposalBallot" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "choice" "ProposalChoice" NOT NULL,

    CONSTRAINT "ProposalBallot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalEvent" (
    "id" SERIAL NOT NULL,
    "proposalId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorDiscordId" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Proposal_status_closesAt_idx" ON "Proposal"("status", "closesAt");

-- CreateIndex
CREATE INDEX "Proposal_proposerDiscordId_idx" ON "Proposal"("proposerDiscordId");

-- CreateIndex
CREATE INDEX "ProposalVoter_discordId_idx" ON "ProposalVoter"("discordId");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalBallot_proposalId_tokenHash_key" ON "ProposalBallot"("proposalId", "tokenHash");

-- CreateIndex
CREATE INDEX "ProposalEvent_proposalId_createdAt_idx" ON "ProposalEvent"("proposalId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentRequest_proposalId_idx" ON "PaymentRequest"("proposalId");

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalVoter" ADD CONSTRAINT "ProposalVoter_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalBallot" ADD CONSTRAINT "ProposalBallot_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalEvent" ADD CONSTRAINT "ProposalEvent_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
