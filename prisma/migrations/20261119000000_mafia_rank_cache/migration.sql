-- CreateTable
CREATE TABLE "MafiaRankCache" (
    "memberId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "tier" VARCHAR(80) NOT NULL,
    "points" INTEGER NOT NULL,
    "inputs" JSONB NOT NULL,
    "memberName" TEXT NOT NULL DEFAULT '',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MafiaRankCache_pkey" PRIMARY KEY ("memberId")
);

-- CreateIndex
CREATE INDEX "MafiaRankCache_computedAt_idx" ON "MafiaRankCache"("computedAt");
