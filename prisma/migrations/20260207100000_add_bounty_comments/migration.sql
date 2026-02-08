-- CreateTable
CREATE TABLE "BountyComment" (
    "id" SERIAL NOT NULL,
    "bountyId" INTEGER NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BountyComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BountyComment_bountyId_createdAt_idx" ON "BountyComment"("bountyId", "createdAt");

-- AddForeignKey
ALTER TABLE "BountyComment" ADD CONSTRAINT "BountyComment_bountyId_fkey" FOREIGN KEY ("bountyId") REFERENCES "Bounty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
