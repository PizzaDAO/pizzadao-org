-- AlterTable
ALTER TABLE "Proposal" ADD COLUMN "beneficiaryDiscordId" TEXT,
ADD COLUMN "isTest" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Proposal_beneficiaryDiscordId_idx" ON "Proposal"("beneficiaryDiscordId");

-- CreateIndex
CREATE INDEX "Proposal_source_isTest_status_idx" ON "Proposal"("source", "isTest", "status");
