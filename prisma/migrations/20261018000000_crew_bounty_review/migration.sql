-- Custom Crew Bounties v2 (jalapeno-82565): submit -> review -> pay.
--
--   * BountyStatus gains SUBMITTED (claimer submitted work, awaiting review).
--   * NotificationType gains BOUNTY_SUBMITTED and BOUNTY_REJECTED.
--   * Bounty gains the submission / review columns.
--
-- ADDITIVE ONLY and hand-written to be re-runnable (IF NOT EXISTS everywhere).
-- Nothing here uses the new enum values, so the "new enum value can't be used
-- in the transaction that added it" rule does not apply.

ALTER TYPE "BountyStatus" ADD VALUE IF NOT EXISTS 'SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BOUNTY_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BOUNTY_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BOUNTY_CANCELLED';
ALTER TABLE "Bounty" ADD COLUMN IF NOT EXISTS "submissionNote" TEXT;
ALTER TABLE "Bounty" ADD COLUMN IF NOT EXISTS "submissionLink" TEXT;
ALTER TABLE "Bounty" ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3);
ALTER TABLE "Bounty" ADD COLUMN IF NOT EXISTS "reviewedBy" TEXT;
ALTER TABLE "Bounty" ADD COLUMN IF NOT EXISTS "reviewNote" TEXT;
ALTER TABLE "Bounty" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);
