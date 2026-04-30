-- AlterTable: drop pointsAwarded column and rename claimedAt
ALTER TABLE "UnlockTicketClaim" DROP COLUMN "pointsAwarded";
ALTER TABLE "UnlockTicketClaim" RENAME COLUMN "claimedAt" TO "connectedAt";

-- DropIndex: allow multiple wallets per user
DROP INDEX "UnlockTicketClaim_discordId_key";

-- CreateIndex: add regular index on discordId for lookups
CREATE INDEX "UnlockTicketClaim_discordId_idx" ON "UnlockTicketClaim"("discordId");
