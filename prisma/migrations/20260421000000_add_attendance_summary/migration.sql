-- CreateTable
CREATE TABLE "AttendanceSummary" (
    "discordId" TEXT NOT NULL,
    "memberId" TEXT,
    "totalCalls" INTEGER NOT NULL,
    "crewBreakdown" JSONB NOT NULL,
    "recentCalls" JSONB NOT NULL,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceSummary_pkey" PRIMARY KEY ("discordId")
);

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceSummary_memberId_key" ON "AttendanceSummary"("memberId");

-- CreateIndex
CREATE INDEX "AttendanceSummary_memberId_idx" ON "AttendanceSummary"("memberId");
