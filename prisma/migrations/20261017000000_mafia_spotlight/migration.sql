-- blackolive-55617: Mafia Spotlight submissions.

-- CreateEnum
CREATE TYPE "SpotlightStatus" AS ENUM ('NEW', 'SHORTLISTED', 'FEATURED', 'DECLINED');

-- CreateTable
CREATE TABLE "SpotlightSubmission" (
    "id" SERIAL NOT NULL,
    "submitterDiscordId" TEXT NOT NULL,
    "submitterMemberId" TEXT,
    "submitterName" TEXT,
    "isSelf" BOOLEAN NOT NULL DEFAULT false,
    "nomineeName" TEXT NOT NULL,
    "nomineeDiscord" TEXT,
    "nomineeDiscordId" TEXT,
    "nomineeMemberId" TEXT,
    "city" TEXT,
    "pitch" TEXT NOT NULL,
    "links" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "photoUrl" TEXT,
    "consent" BOOLEAN NOT NULL,
    "status" "SpotlightStatus" NOT NULL DEFAULT 'NEW',
    "featuredOn" TIMESTAMP(3),
    "adminNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpotlightSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpotlightSubmission_submitterDiscordId_createdAt_idx" ON "SpotlightSubmission"("submitterDiscordId", "createdAt");

-- CreateIndex
CREATE INDEX "SpotlightSubmission_status_createdAt_idx" ON "SpotlightSubmission"("status", "createdAt");
