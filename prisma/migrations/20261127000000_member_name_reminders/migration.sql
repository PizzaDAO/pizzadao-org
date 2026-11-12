-- Additive: one row per name-reminder DM an admin sent (cooldown + audit).
CREATE TABLE "MemberNameReminder" (
    "id" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "sentBy" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "claimKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberNameReminder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MemberNameReminder_discordId_createdAt_idx" ON "MemberNameReminder"("discordId", "createdAt");

CREATE UNIQUE INDEX "MemberNameReminder_claimKey_key" ON "MemberNameReminder"("claimKey");
