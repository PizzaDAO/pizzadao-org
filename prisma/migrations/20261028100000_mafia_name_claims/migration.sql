-- Claimed mafia names (plans/mafia-name-port.md, Phase 2). Backs the public /made/[id]
-- certificate. ADDITIVE ONLY (one new table); re-runnable. Requires 20261028000000_mafia_portraits.
CREATE TABLE IF NOT EXISTS "MafiaNameClaim" (
  "id" TEXT NOT NULL,
  "discordId" TEXT NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "origin" JSONB,
  "topping" VARCHAR(50) NOT NULL,
  "filmId" VARCHAR(60),
  "filmTitle" VARCHAR(120) NOT NULL,
  "tmdbMovieId" VARCHAR(20),
  "candidates" JSONB NOT NULL,
  "source" VARCHAR(16) NOT NULL DEFAULT 'join',
  "portraitId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MafiaNameClaim_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MafiaNameClaim_discordId_name_key" ON "MafiaNameClaim"("discordId", "name");
CREATE INDEX IF NOT EXISTS "MafiaNameClaim_createdAt_idx" ON "MafiaNameClaim"("createdAt");

DO $$ BEGIN
  ALTER TABLE "MafiaNameClaim"
    ADD CONSTRAINT "MafiaNameClaim_portraitId_fkey"
    FOREIGN KEY ("portraitId") REFERENCES "MafiaPortrait"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
