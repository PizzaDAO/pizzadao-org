-- Proposals history import (plans/proposals-history-import.md).
-- ADDITIVE ONLY: new enum + enum value, new nullable/defaulted columns, two new tables. No existing row changes.
-- Safe to re-run. The CHECK below avoids the new enum value on purpose: a value added by ALTER TYPE cannot be used in the same transaction.

DO $$ BEGIN
  CREATE TYPE "ProposalSource" AS ENUM ('APP', 'IMPORTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TYPE "ProposalStatus" ADD VALUE IF NOT EXISTS 'UNRESOLVED';

ALTER TABLE "Proposal"
  ADD COLUMN IF NOT EXISTS "source"        "ProposalSource" NOT NULL DEFAULT 'APP',
  ADD COLUMN IF NOT EXISTS "importKey"     TEXT,
  ADD COLUMN IF NOT EXISTS "proposerLabel" TEXT,
  ADD COLUMN IF NOT EXISTS "votesRecorded" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "outcomeSource" TEXT,
  ADD COLUMN IF NOT EXISTS "paidOverride"  BOOLEAN,
  ADD COLUMN IF NOT EXISTS "historical"    JSONB;

ALTER TABLE "Proposal" ALTER COLUMN "proposerDiscordId" DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Proposal_importKey_key" ON "Proposal"("importKey");
CREATE INDEX IF NOT EXISTS "Proposal_status_closedAt_idx" ON "Proposal"("status", "closedAt");

-- An imported row can never be a draft or open: no vote UI, no cron, no ballots.
DO $$ BEGIN
  ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_imported_closed"
    CHECK ("source" = 'APP' OR "status" NOT IN ('DRAFT', 'OPEN'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ProposalLink" (
    "id" SERIAL NOT NULL,
    "proposalId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "url" TEXT,
    "label" TEXT,
    "sourceKey" TEXT NOT NULL,
    CONSTRAINT "ProposalLink_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProposalLink_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProposalLink_proposalId_sourceKey_key" ON "ProposalLink"("proposalId", "sourceKey");

CREATE TABLE IF NOT EXISTS "ProposalPayment" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3),
    "amount" DECIMAL(38,18),
    "asset" TEXT,
    "chain" TEXT,
    "usdValue" INTEGER,
    "txHash" TEXT,
    "offchainRef" TEXT,
    "note" TEXT,
    "source" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProposalPayment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProposalPayment_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProposalPayment_proposalId_sourceKey_key" ON "ProposalPayment"("proposalId", "sourceKey");
CREATE INDEX IF NOT EXISTS "ProposalPayment_proposalId_idx" ON "ProposalPayment"("proposalId");
-- NOT unique (deviation from the plan): one batch payout transaction legitimately funds several proposals.
-- Duplicates are prevented per proposal by ("proposalId", "sourceKey") above; this index only answers
-- "which proposals did this tx pay".
CREATE INDEX IF NOT EXISTS "ProposalPayment_chain_txHash_idx" ON "ProposalPayment"("chain", "txHash") WHERE "txHash" IS NOT NULL;
