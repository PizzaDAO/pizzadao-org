-- Additive: one row per batch of live Discord message counts already applied to "DiscordActivity"
-- (idempotency: a batch id seen twice is applied once). Old rows are pruned by the app.
CREATE TABLE IF NOT EXISTS "DiscordActivityBatch" (
    "id" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscordActivityBatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DiscordActivityBatch_appliedAt_idx" ON "DiscordActivityBatch"("appliedAt");
