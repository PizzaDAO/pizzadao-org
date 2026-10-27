-- Private filters for automated call posts. ADDITIVE ONLY (one new table, no seed rows); re-runnable.
CREATE TABLE IF NOT EXISTS "CallPostFilter" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "excludedCrewIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "excludedCrewLabelTerms" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "blockedTerms" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT,
  CONSTRAINT "CallPostFilter_pkey" PRIMARY KEY ("id")
);
