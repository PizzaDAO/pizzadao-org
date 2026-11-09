-- AlterTable
ALTER TABLE "MemberPfp" ADD COLUMN     "originalBaseKind" VARCHAR(16),
ADD COLUMN     "originalBaseUrl" TEXT;

-- CreateTable
CREATE TABLE "PfpRestyle" (
    "id" SERIAL NOT NULL,
    "memberId" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "outfitId" INTEGER NOT NULL,
    "outfitName" VARCHAR(60) NOT NULL,
    "costCents" INTEGER NOT NULL,
    "status" VARCHAR(12) NOT NULL,
    "resultUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PfpRestyle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PfpRestyle_memberId_createdAt_idx" ON "PfpRestyle"("memberId", "createdAt");

-- CreateIndex
CREATE INDEX "PfpRestyle_memberId_outfitId_idx" ON "PfpRestyle"("memberId", "outfitId");

-- CreateIndex
CREATE INDEX "PfpRestyle_createdAt_idx" ON "PfpRestyle"("createdAt");

