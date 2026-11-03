-- Typed replies to follow-ups (plans/followup-replies-inbox.md). ADDITIVE ONLY: one nullable column
-- and a unique index (nulls are not unique-constrained); re-runnable.
ALTER TABLE "FollowUpEvent" ADD COLUMN IF NOT EXISTS "externalKey" VARCHAR(120);
CREATE UNIQUE INDEX IF NOT EXISTS "FollowUpEvent_externalKey_key" ON "FollowUpEvent"("externalKey");
