-- Call Slices (ERC-1155 attendance NFTs). ADDITIVE ONLY (new tables + one seed row); re-runnable.
-- PoapMintLink is intentionally left in place (harmless, no code uses it any more).
CREATE TABLE IF NOT EXISTS "AttendanceNftCall" (
  "id" SERIAL NOT NULL,
  "crewId" TEXT NOT NULL,
  "crewLabel" TEXT NOT NULL,
  "callDay" DATE NOT NULL,
  "imageUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttendanceNftCall_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AttendanceNftCall_crewId_callDay_key" ON "AttendanceNftCall"("crewId", "callDay");

CREATE TABLE IF NOT EXISTS "AttendanceNftClaim" (
  "id" TEXT NOT NULL,
  "discordId" TEXT NOT NULL,
  "memberId" TEXT,
  "callId" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "recipient" TEXT,
  "txHash" TEXT,
  "chainId" INTEGER,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submittedAt" TIMESTAMP(3),
  "mintedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AttendanceNftClaim_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AttendanceNftClaim_callId_fkey" FOREIGN KEY ("callId") REFERENCES "AttendanceNftCall"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "AttendanceNftClaim_discordId_callId_key" ON "AttendanceNftClaim"("discordId", "callId");
CREATE INDEX IF NOT EXISTS "AttendanceNftClaim_status_claimedAt_idx" ON "AttendanceNftClaim"("status", "claimedAt");
CREATE INDEX IF NOT EXISTS "AttendanceNftClaim_memberId_idx" ON "AttendanceNftClaim"("memberId");

CREATE TABLE IF NOT EXISTS "SliceCrewArt" (
  "crewId" TEXT NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SliceCrewArt_pkey" PRIMARY KEY ("crewId")
);

CREATE TABLE IF NOT EXISTS "SliceMintLease" (
  "id" INTEGER NOT NULL,
  "holder" TEXT,
  "leaseUntil" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastAlertAt" TIMESTAMP(3),
  CONSTRAINT "SliceMintLease_pkey" PRIMARY KEY ("id")
);
INSERT INTO "SliceMintLease" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
