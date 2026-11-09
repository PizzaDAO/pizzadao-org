-- Measured presence in recorded calls (plans/live-call-view-and-attendance.md, PR 1).
-- ADDITIVE ONLY: one new table, two new nullable columns. No existing row changes. Safe to re-run.

CREATE TABLE IF NOT EXISTS "CallPresence" (
  "id"          TEXT NOT NULL,
  "recordingId" TEXT NOT NULL,
  "discordId"   TEXT NOT NULL,
  "displayName" TEXT,
  "presentSec"  INTEGER NOT NULL,
  "firstSeenMs" INTEGER NOT NULL,
  "lastSeenMs"  INTEGER NOT NULL,
  CONSTRAINT "CallPresence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CallPresence_recordingId_discordId_key" ON "CallPresence"("recordingId", "discordId");
CREATE INDEX IF NOT EXISTS "CallPresence_discordId_idx" ON "CallPresence"("discordId");

DO $$ BEGIN
  ALTER TABLE "CallPresence" ADD CONSTRAINT "CallPresence_recordingId_fkey"
    FOREIGN KEY ("recordingId") REFERENCES "CallRecording"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "CallAttendance" ADD COLUMN IF NOT EXISTS "presentSec" INTEGER;
ALTER TABLE "CallAttendance" ADD COLUMN IF NOT EXISTS "recordingId" TEXT;
ALTER TABLE "CallRecording" ADD COLUMN IF NOT EXISTS "scheduledSec" INTEGER;
