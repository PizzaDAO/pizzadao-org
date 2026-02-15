-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('TWITTER', 'FARCASTER');

-- CreateEnum
CREATE TYPE "FriendSource" AS ENUM ('PIZZADAO', 'TWITTER', 'FARCASTER');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'FRIEND_ADDED';

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" SERIAL NOT NULL,
    "memberId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "handle" TEXT NOT NULL,
    "platformId" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Friendship" (
    "id" SERIAL NOT NULL,
    "followerId" TEXT NOT NULL,
    "followeeId" TEXT NOT NULL,
    "source" "FriendSource" NOT NULL DEFAULT 'PIZZADAO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Friendship_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SocialAccount_platform_handle_idx" ON "SocialAccount"("platform", "handle");

-- CreateIndex
CREATE INDEX "SocialAccount_platform_platformId_idx" ON "SocialAccount"("platform", "platformId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_memberId_platform_key" ON "SocialAccount"("memberId", "platform");

-- CreateIndex
CREATE INDEX "Friendship_followerId_idx" ON "Friendship"("followerId");

-- CreateIndex
CREATE INDEX "Friendship_followeeId_idx" ON "Friendship"("followeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Friendship_followerId_followeeId_key" ON "Friendship"("followerId", "followeeId");
