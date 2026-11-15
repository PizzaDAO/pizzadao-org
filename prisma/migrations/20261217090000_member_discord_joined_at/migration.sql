-- Additive: the Discord server join date for "member since", and when we last looked it up.
ALTER TABLE "MemberProfileExtras" ADD COLUMN IF NOT EXISTS "discordJoinedAt" TIMESTAMP(3);
ALTER TABLE "MemberProfileExtras" ADD COLUMN IF NOT EXISTS "discordJoinedCheckedAt" TIMESTAMP(3);
