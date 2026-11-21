-- "Sign in with Telegram": one row per sign-in attempt from /login (hashes only, no codes).
-- Purely additive: one new table, nothing existing changes.

-- CreateTable
CREATE TABLE "TelegramSignInRequest" (
    "codeHash" TEXT NOT NULL,
    "browserHash" TEXT NOT NULL,
    "matchNumber" INTEGER NOT NULL,
    "returnTo" TEXT,
    "tgId" TEXT,
    "discordId" TEXT,
    "ref" TEXT,
    "claimedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramSignInRequest_pkey" PRIMARY KEY ("codeHash")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramSignInRequest_ref_key" ON "TelegramSignInRequest"("ref");

-- CreateIndex
CREATE INDEX "TelegramSignInRequest_expiresAt_idx" ON "TelegramSignInRequest"("expiresAt");

-- CreateIndex
CREATE INDEX "TelegramSignInRequest_tgId_createdAt_idx" ON "TelegramSignInRequest"("tgId", "createdAt");
