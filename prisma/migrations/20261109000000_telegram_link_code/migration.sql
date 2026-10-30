-- CreateTable
CREATE TABLE "TelegramLinkCode" (
    "codeHash" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tgId" TEXT,
    "tgUsername" TEXT,
    "tgFirstName" TEXT,
    "tgLastName" TEXT,
    "ref" TEXT,
    "claimedAt" TIMESTAMP(3),
    "tgConfirmedAt" TIMESTAMP(3),

    CONSTRAINT "TelegramLinkCode_pkey" PRIMARY KEY ("codeHash")
);

-- CreateIndex
CREATE INDEX "TelegramLinkCode_discordId_idx" ON "TelegramLinkCode"("discordId");

-- CreateIndex
CREATE INDEX "TelegramLinkCode_expiresAt_idx" ON "TelegramLinkCode"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramLinkCode_ref_key" ON "TelegramLinkCode"("ref");
