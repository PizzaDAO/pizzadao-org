-- CreateTable
CREATE TABLE "XAccount" (
    "id" SERIAL NOT NULL,
    "discordId" TEXT NOT NULL,
    "memberId" TEXT,
    "xId" TEXT NOT NULL,
    "xUsername" TEXT NOT NULL,
    "xDisplayName" TEXT,
    "xProfileImageUrl" TEXT,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "XAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "XAccount_discordId_key" ON "XAccount"("discordId");

-- CreateIndex
CREATE UNIQUE INDEX "XAccount_xId_key" ON "XAccount"("xId");

-- CreateIndex
CREATE INDEX "XAccount_memberId_idx" ON "XAccount"("memberId");
