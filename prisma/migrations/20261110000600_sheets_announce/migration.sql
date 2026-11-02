-- Google Sheets cutover, Community Call announcement (plans/sheets-cutover.md, PR 8). ADDITIVE ONLY
-- (two new tables, no seed rows); re-runnable.
CREATE TABLE IF NOT EXISTS "AnnounceState" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "sendValue" TEXT NOT NULL DEFAULT '',
  "lastSentValue" TEXT NOT NULL DEFAULT '',
  "lastError" TEXT NOT NULL DEFAULT '',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT,
  CONSTRAINT "AnnounceState_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Announcement" (
  "id" TEXT NOT NULL,
  "naturalKey" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "url" TEXT,
  "crew" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT '',
  "position" INTEGER NOT NULL,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Announcement_naturalKey_key" ON "Announcement"("naturalKey");
CREATE INDEX IF NOT EXISTS "Announcement_archived_position_idx" ON "Announcement"("archived", "position");
