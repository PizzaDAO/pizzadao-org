-- Last good copy of a guild's channel / role list, served when Discord is slow or down.
-- Purely additive: one new table, nothing existing changes.

-- CreateTable
CREATE TABLE "DiscordGuildSnapshot" (
    "guildId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscordGuildSnapshot_pkey" PRIMARY KEY ("guildId","kind")
);
