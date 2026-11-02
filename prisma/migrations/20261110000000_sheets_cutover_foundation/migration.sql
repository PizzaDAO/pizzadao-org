-- Google Sheets cutover foundation (plans/sheets-cutover.md, PR 0): the import audit log and the raw
-- snapshot archive. ADDITIVE ONLY (two new tables, no seed rows); re-runnable.
CREATE TABLE IF NOT EXISTS "SheetImportRun" (
  "id" SERIAL NOT NULL,
  "dataset" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "ok" BOOLEAN NOT NULL,
  "counts" JSONB NOT NULL,
  "issues" JSONB,
  "error" TEXT,
  "sheetRevision" TEXT,
  "actor" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "SheetImportRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SheetImportRun_dataset_startedAt_idx" ON "SheetImportRun"("dataset", "startedAt");

CREATE TABLE IF NOT EXISTS "SheetSnapshot" (
  "id" SERIAL NOT NULL,
  "batchId" TEXT NOT NULL,
  "sheetKey" TEXT NOT NULL,
  "sheetId" TEXT NOT NULL,
  "tab" TEXT NOT NULL,
  "rowCount" INTEGER NOT NULL,
  "data" JSONB NOT NULL,
  "takenBy" TEXT NOT NULL,
  "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SheetSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SheetSnapshot_batchId_idx" ON "SheetSnapshot"("batchId");
CREATE INDEX IF NOT EXISTS "SheetSnapshot_sheetKey_takenAt_idx" ON "SheetSnapshot"("sheetKey", "takenAt");
