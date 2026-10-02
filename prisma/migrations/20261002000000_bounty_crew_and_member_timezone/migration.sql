-- jalapeno-82565 (custom crew bounties): optional crew tag on bounties.
-- Nullable, no default => existing bounties stay "general" bounties.
ALTER TABLE "Bounty" ADD COLUMN IF NOT EXISTS "crewId" TEXT;

CREATE INDEX IF NOT EXISTS "Bounty_crewId_status_idx" ON "Bounty"("crewId", "status");

-- pizzaiolo-13628 (timezone for crew sheet): the members "Crew" sheet has no
-- Timezone column, so the IANA timezone resolved from the onboarding city is
-- stored in Postgres instead.
ALTER TABLE "MemberProfileExtras" ADD COLUMN IF NOT EXISTS "timezone" VARCHAR(64);
