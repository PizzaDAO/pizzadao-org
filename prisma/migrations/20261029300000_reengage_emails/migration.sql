-- Weekly re-engagement email (task/reengage-emails). ADDITIVE ONLY; re-runnable.
ALTER TABLE "MemberProfileExtras" ADD COLUMN IF NOT EXISTS "email" VARCHAR(254);
ALTER TABLE "MemberProfileExtras" ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP(3);
ALTER TABLE "MemberProfileExtras" ADD COLUMN IF NOT EXISTS "emailConfirmSentAt" TIMESTAMP(3);
ALTER TABLE "MemberProfileExtras" ADD COLUMN IF NOT EXISTS "reengageEmailOptIn" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "ReengageEmailSend" (
  "id" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "weekKey" VARCHAR(10) NOT NULL,
  "status" VARCHAR(10) NOT NULL DEFAULT 'SENDING',
  "locale" VARCHAR(5) NOT NULL DEFAULT 'en',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  CONSTRAINT "ReengageEmailSend_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ReengageEmailSend_memberId_weekKey_key" ON "ReengageEmailSend"("memberId", "weekKey");
CREATE INDEX IF NOT EXISTS "ReengageEmailSend_weekKey_idx" ON "ReengageEmailSend"("weekKey");
