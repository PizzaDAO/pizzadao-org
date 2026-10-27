-- POAP mint-link pool for member claims. ADDITIVE ONLY (one new table); re-runnable.
CREATE TABLE IF NOT EXISTS "PoapMintLink" (
  "id" SERIAL NOT NULL,
  "crewId" TEXT NOT NULL,
  "callDay" DATE NOT NULL,
  "link" TEXT NOT NULL,
  "claimedBy" TEXT,
  "claimedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PoapMintLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PoapMintLink_link_key" ON "PoapMintLink"("link");
CREATE UNIQUE INDEX IF NOT EXISTS "PoapMintLink_crewId_callDay_claimedBy_key" ON "PoapMintLink"("crewId", "callDay", "claimedBy");
CREATE INDEX IF NOT EXISTS "PoapMintLink_claimedBy_idx" ON "PoapMintLink"("claimedBy");
