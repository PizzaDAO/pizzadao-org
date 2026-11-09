-- CreateTable
CREATE TABLE "UnlockLock" (
    "id" SERIAL NOT NULL,
    "networkId" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "year" INTEGER,
    "eventSlug" VARCHAR(200),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "source" VARCHAR(12) NOT NULL DEFAULT 'seed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnlockLock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnlockKey" (
    "id" SERIAL NOT NULL,
    "memberId" TEXT NOT NULL,
    "networkId" INTEGER NOT NULL,
    "lockAddress" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "gone" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "goneAt" TIMESTAMP(3),

    CONSTRAINT "UnlockKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnlockScanState" (
    "memberId" TEXT NOT NULL,
    "lastScanAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastError" VARCHAR(300),
    "ticketCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UnlockScanState_pkey" PRIMARY KEY ("memberId")
);

-- CreateIndex
CREATE INDEX "UnlockLock_enabled_idx" ON "UnlockLock"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "UnlockLock_networkId_address_key" ON "UnlockLock"("networkId", "address");

-- CreateIndex
CREATE INDEX "UnlockKey_memberId_idx" ON "UnlockKey"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "UnlockKey_networkId_lockAddress_tokenId_owner_key" ON "UnlockKey"("networkId", "lockAddress", "tokenId", "owner");
