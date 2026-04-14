-- CreateEnum
CREATE TYPE "MissionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'MISSION_REWARD';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'MISSION_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'MISSION_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'LEVEL_COMPLETED';

-- CreateTable
CREATE TABLE "Mission" (
    "id" SERIAL NOT NULL,
    "level" INTEGER NOT NULL,
    "index" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "reward" INTEGER NOT NULL DEFAULT 0,
    "levelTitle" TEXT,
    "autoVerify" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissionCompletion" (
    "id" SERIAL NOT NULL,
    "missionId" INTEGER NOT NULL,
    "discordId" TEXT NOT NULL,
    "memberId" TEXT,
    "status" "MissionStatus" NOT NULL DEFAULT 'PENDING',
    "evidence" TEXT,
    "notes" TEXT,
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "MissionCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Mission_level_index_key" ON "Mission"("level", "index");

-- CreateIndex
CREATE UNIQUE INDEX "MissionCompletion_missionId_discordId_key" ON "MissionCompletion"("missionId", "discordId");

-- CreateIndex
CREATE INDEX "MissionCompletion_discordId_idx" ON "MissionCompletion"("discordId");

-- CreateIndex
CREATE INDEX "MissionCompletion_status_idx" ON "MissionCompletion"("status");

-- AddForeignKey
ALTER TABLE "MissionCompletion" ADD CONSTRAINT "MissionCompletion_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
