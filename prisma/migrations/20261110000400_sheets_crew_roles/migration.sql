-- Google Sheets cutover, crew rosters / roles (plans/sheets-cutover.md, PR 5). ADDITIVE ONLY (one
-- new table, no seed rows); re-runnable.
CREATE TABLE IF NOT EXISTS "CrewRole" (
  "id" TEXT NOT NULL,
  "crewId" TEXT NOT NULL,
  "naturalKey" TEXT NOT NULL,
  "memberId" TEXT,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT '',
  "city" TEXT NOT NULL DEFAULT '',
  "org" TEXT NOT NULL DEFAULT '',
  "skills" TEXT NOT NULL DEFAULT '',
  "turtles" TEXT NOT NULL DEFAULT '',
  "telegram" TEXT NOT NULL DEFAULT '',
  "attendance" TEXT NOT NULL DEFAULT '',
  "notes" TEXT NOT NULL DEFAULT '',
  "position" INTEGER NOT NULL,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrewRole_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CrewRole_crewId_naturalKey_key" ON "CrewRole"("crewId", "naturalKey");
CREATE INDEX IF NOT EXISTS "CrewRole_crewId_archived_position_idx" ON "CrewRole"("crewId", "archived", "position");
CREATE INDEX IF NOT EXISTS "CrewRole_memberId_idx" ON "CrewRole"("memberId");
