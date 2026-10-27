-- Anonymous claims from the public /get-your-mafia-name page (plans/mafia-name-port.md,
-- Phase 3). Requires 20261028100000_mafia_name_claims. Re-runnable; no data is changed.
--   * discordId becomes nullable (public claims have no member)
--   * actor: the anonymous browser id of a public claim; (actor, name) is unique.
-- Postgres treats NULLs as distinct in unique indexes, so member rows (actor NULL)
-- and public rows (discordId NULL) never collide with each other.
ALTER TABLE "MafiaNameClaim" ALTER COLUMN "discordId" DROP NOT NULL;
ALTER TABLE "MafiaNameClaim" ADD COLUMN IF NOT EXISTS "actor" VARCHAR(80);
CREATE UNIQUE INDEX IF NOT EXISTS "MafiaNameClaim_actor_name_key" ON "MafiaNameClaim"("actor", "name");
