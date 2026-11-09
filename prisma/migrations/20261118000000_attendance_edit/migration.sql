-- Admin add/remove of attendance rows (plans/live-call-view-and-attendance.md, PR 2).
-- ADDITIVE ONLY: one new table. Safe to re-run.

CREATE TABLE IF NOT EXISTS "AttendanceEdit" (
  "id"        SERIAL NOT NULL,
  "action"    TEXT NOT NULL,
  "discordId" TEXT NOT NULL,
  "crewId"    TEXT NOT NULL,
  "callDate"  TIMESTAMP(3) NOT NULL,
  "actorId"   TEXT NOT NULL,
  "reason"    TEXT,
  "source"    TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttendanceEdit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AttendanceEdit_crewId_callDate_idx" ON "AttendanceEdit"("crewId", "callDate");
CREATE INDEX IF NOT EXISTS "AttendanceEdit_discordId_idx" ON "AttendanceEdit"("discordId");
