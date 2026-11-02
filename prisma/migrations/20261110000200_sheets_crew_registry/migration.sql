-- Google Sheets cutover, crew registry (plans/sheets-cutover.md, PR 3). ADDITIVE ONLY (one new
-- table, no seed rows); re-runnable.
CREATE TABLE IF NOT EXISTS "Crew" (
  "id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "emoji" TEXT,
  "turtles" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "role" TEXT,
  "channel" TEXT,
  "event" TEXT,
  "callTime" TEXT,
  "callTimeUrl" TEXT,
  "callLength" TEXT,
  "type" TEXT,
  "script" TEXT,
  "legacySheetUrl" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT,
  CONSTRAINT "Crew_pkey" PRIMARY KEY ("id")
);
