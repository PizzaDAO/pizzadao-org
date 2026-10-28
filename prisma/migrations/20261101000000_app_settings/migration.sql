-- Admin-editable rules and their audit log. ADDITIVE ONLY (two new tables, no seed rows); re-runnable.
CREATE TABLE IF NOT EXISTS "AppSetting" (
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "updatedBy" TEXT NOT NULL,
  CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "AppSettingChange" (
  "id" SERIAL NOT NULL,
  "key" TEXT NOT NULL,
  "oldValue" JSONB,
  "newValue" JSONB,
  "changedBy" TEXT NOT NULL,
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "note" TEXT,
  CONSTRAINT "AppSettingChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AppSettingChange_key_changedAt_idx" ON "AppSettingChange"("key", "changedAt");
CREATE INDEX IF NOT EXISTS "AppSettingChange_changedAt_idx" ON "AppSettingChange"("changedAt");
