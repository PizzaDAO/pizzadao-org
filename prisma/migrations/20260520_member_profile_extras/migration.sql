-- Plan: truffle-91035 (PR4 — burrata-13316).
-- Member-owned profile extras. Additive only — new table, no ALTERs.

-- CreateTable
CREATE TABLE IF NOT EXISTS "MemberProfileExtras" (
    "memberId"  TEXT NOT NULL,
    "tagline"   VARCHAR(140),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberProfileExtras_pkey" PRIMARY KEY ("memberId")
);
