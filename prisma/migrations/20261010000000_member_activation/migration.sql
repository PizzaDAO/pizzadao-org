ALTER TABLE "MagicLoginToken" ADD COLUMN "signupDraft" JSONB;
CREATE TABLE "ActivationEvent" (
  "id" TEXT NOT NULL,
  "actor" TEXT NOT NULL,
  "memberKey" TEXT,
  "event" TEXT NOT NULL,
  "code" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActivationEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ActivationEvent_actor_event_code_key" ON "ActivationEvent"("actor", "event", "code");
CREATE INDEX "ActivationEvent_createdAt_event_idx" ON "ActivationEvent"("createdAt", "event");
CREATE INDEX "ActivationEvent_memberKey_event_idx" ON "ActivationEvent"("memberKey", "event");
