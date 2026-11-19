-- Capo image review (dough ball review). Purely additive: one enum, three new tables.

-- CreateEnum
CREATE TYPE "ImageReviewVoteValue" AS ENUM ('YES', 'NO');

-- CreateTable
CREATE TABLE "ImageReviewSet" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImageReviewSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImageReviewCandidate" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "traits" JSONB NOT NULL DEFAULT '{}',
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImageReviewCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImageReviewVote" (
    "candidateId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "vote" "ImageReviewVoteValue" NOT NULL,
    "comment" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImageReviewVote_pkey" PRIMARY KEY ("candidateId","discordId")
);

-- CreateIndex
CREATE UNIQUE INDEX "ImageReviewSet_slug_key" ON "ImageReviewSet"("slug");

-- CreateIndex
CREATE INDEX "ImageReviewCandidate_setId_position_idx" ON "ImageReviewCandidate"("setId", "position");

-- CreateIndex
CREATE INDEX "ImageReviewVote_discordId_idx" ON "ImageReviewVote"("discordId");

-- AddForeignKey
ALTER TABLE "ImageReviewCandidate" ADD CONSTRAINT "ImageReviewCandidate_setId_fkey" FOREIGN KEY ("setId") REFERENCES "ImageReviewSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImageReviewVote" ADD CONSTRAINT "ImageReviewVote_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "ImageReviewCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
