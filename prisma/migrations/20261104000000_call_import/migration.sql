-- CreateEnum
CREATE TYPE "CallSource" AS ENUM ('DISCORD', 'X_SPACE', 'X_BROADCAST');

-- AlterTable
ALTER TABLE "CallRecording" ADD COLUMN     "source" "CallSource" NOT NULL DEFAULT 'DISCORD',
ADD COLUMN     "sourceUrl" TEXT,
ADD COLUMN     "importedAt" TIMESTAMP(3),
ADD COLUMN     "importedBy" TEXT,
ADD COLUMN     "importMeta" JSONB,
ADD COLUMN     "speakerLabelsUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CallSpeaker" ADD COLUMN     "linkedDiscordId" TEXT;

-- CreateIndex
CREATE INDEX "CallRecording_source_startedAt_idx" ON "CallRecording"("source", "startedAt");

-- CreateIndex
CREATE INDEX "CallSpeaker_linkedDiscordId_idx" ON "CallSpeaker"("linkedDiscordId");
