-- Google Sheets cutover, members (plans/sheets-cutover.md, PR 7). ADDITIVE ONLY (two new tables, no
-- seed rows); re-runnable.
CREATE TABLE IF NOT EXISTS "Member" (
  "id" TEXT NOT NULL,
  "discordId" TEXT,
  "name" TEXT NOT NULL DEFAULT '',
  "cells" JSONB NOT NULL,
  "position" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT,
  CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Member_discordId_idx" ON "Member"("discordId");
CREATE INDEX IF NOT EXISTS "Member_position_idx" ON "Member"("position");

CREATE TABLE IF NOT EXISTS "MemberTableLayout" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "headers" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT,
  CONSTRAINT "MemberTableLayout_pkey" PRIMARY KEY ("id")
);
