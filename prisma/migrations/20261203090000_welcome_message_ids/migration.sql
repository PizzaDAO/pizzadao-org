-- Additive: remember the welcome channel post so it can be removed when the member leaves.

-- AlterTable
ALTER TABLE "TraineeWelcome" ADD COLUMN     "channelId" TEXT,
ADD COLUMN     "channelMessageId" TEXT,
ADD COLUMN     "channelDeletedAt" TIMESTAMP(3);
