-- AI finale portrait cache (plans/mafia-name-port.md, Phase 1). ADDITIVE ONLY; re-runnable.
CREATE TABLE IF NOT EXISTS "MafiaPortrait" (
  "id" TEXT NOT NULL,
  "cacheKey" TEXT NOT NULL,
  "name" VARCHAR(80) NOT NULL,
  "topping" VARCHAR(50) NOT NULL,
  "filmKey" VARCHAR(120) NOT NULL,
  "variant" INTEGER NOT NULL DEFAULT 0,
  "animal" VARCHAR(40) NOT NULL,
  "model" VARCHAR(80) NOT NULL,
  "url" TEXT NOT NULL,
  "discordId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MafiaPortrait_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MafiaPortrait_cacheKey_key" ON "MafiaPortrait"("cacheKey");
CREATE INDEX IF NOT EXISTS "MafiaPortrait_discordId_createdAt_idx" ON "MafiaPortrait"("discordId", "createdAt");
