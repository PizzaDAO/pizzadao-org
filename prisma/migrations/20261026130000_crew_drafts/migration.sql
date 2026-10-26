-- Crew content drafts (Comms compose). ADDITIVE ONLY; re-runnable.
DO $$ BEGIN
  CREATE TYPE "CrewDraftPlatform" AS ENUM ('X', 'LINKEDIN', 'DISCORD', 'TELEGRAM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "CrewDraftStatus" AS ENUM ('DRAFT', 'READY', 'POSTED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "CrewDraft" (
  "id" SERIAL NOT NULL,
  "crewId" TEXT NOT NULL,
  "platform" "CrewDraftPlatform" NOT NULL DEFAULT 'X',
  "text" TEXT NOT NULL,
  "mediaUrl" TEXT,
  "notes" TEXT,
  "status" "CrewDraftStatus" NOT NULL DEFAULT 'DRAFT',
  "createdBy" TEXT NOT NULL,
  "updatedBy" TEXT NOT NULL,
  "postedBy" TEXT,
  "postedAt" TIMESTAMP(3),
  "postedUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrewDraft_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CrewDraft_crewId_status_idx" ON "CrewDraft"("crewId", "status");
