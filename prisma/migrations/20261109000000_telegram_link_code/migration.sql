-- CreateTable
CREATE TABLE "TelegramLinkCode" (
    "codeHash" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramLinkCode_pkey" PRIMARY KEY ("codeHash")
);

-- CreateIndex
CREATE INDEX "TelegramLinkCode_discordId_idx" ON "TelegramLinkCode"("discordId");

-- CreateIndex
CREATE INDEX "TelegramLinkCode_expiresAt_idx" ON "TelegramLinkCode"("expiresAt");
