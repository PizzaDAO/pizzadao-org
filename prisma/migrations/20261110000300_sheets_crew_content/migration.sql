-- Google Sheets cutover, crew tasks / agenda steps / goals (plans/sheets-cutover.md, PR 4).
-- ADDITIVE ONLY (four new tables, no seed rows); re-runnable.
CREATE TABLE IF NOT EXISTS "CrewTask" (
  "id" TEXT NOT NULL,
  "crewId" TEXT NOT NULL,
  "naturalKey" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "url" TEXT,
  "stage" TEXT NOT NULL DEFAULT 'todo',
  "priority" TEXT,
  "goal" TEXT,
  "due" TEXT,
  "dueRaw" TEXT,
  "leadName" TEXT,
  "leadMemberId" TEXT,
  "notes" TEXT,
  "position" INTEGER NOT NULL,
  "doneAt" TIMESTAMP(3),
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrewTask_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CrewTask_crewId_naturalKey_key" ON "CrewTask"("crewId", "naturalKey");
CREATE INDEX IF NOT EXISTS "CrewTask_crewId_archived_position_idx" ON "CrewTask"("crewId", "archived", "position");
CREATE INDEX IF NOT EXISTS "CrewTask_leadMemberId_idx" ON "CrewTask"("leadMemberId");

CREATE TABLE IF NOT EXISTS "CrewTaskEvent" (
  "id" SERIAL NOT NULL,
  "taskId" TEXT NOT NULL,
  "crewId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "data" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CrewTaskEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CrewTaskEvent_taskId_createdAt_idx" ON "CrewTaskEvent"("taskId", "createdAt");
CREATE INDEX IF NOT EXISTS "CrewTaskEvent_crewId_createdAt_idx" ON "CrewTaskEvent"("crewId", "createdAt");

CREATE TABLE IF NOT EXISTS "CrewAgendaStep" (
  "id" TEXT NOT NULL,
  "crewId" TEXT NOT NULL,
  "naturalKey" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "time" TEXT,
  "step" TEXT NOT NULL,
  "stepUrl" TEXT,
  "action" TEXT,
  "leadName" TEXT,
  "notes" TEXT,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrewAgendaStep_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CrewAgendaStep_crewId_naturalKey_key" ON "CrewAgendaStep"("crewId", "naturalKey");
CREATE INDEX IF NOT EXISTS "CrewAgendaStep_crewId_archived_position_idx" ON "CrewAgendaStep"("crewId", "archived", "position");

CREATE TABLE IF NOT EXISTS "CrewGoal" (
  "id" TEXT NOT NULL,
  "crewId" TEXT NOT NULL,
  "naturalKey" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "priority" TEXT,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrewGoal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CrewGoal_crewId_naturalKey_key" ON "CrewGoal"("crewId", "naturalKey");
CREATE INDEX IF NOT EXISTS "CrewGoal_crewId_archived_position_idx" ON "CrewGoal"("crewId", "archived", "position");
