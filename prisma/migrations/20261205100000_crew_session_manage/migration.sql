-- Education sessions on the site: manage page, public listing, edit-in-place. Additive only.
ALTER TABLE "CrewSession" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'SCHEDULED';
ALTER TABLE "CrewSession" ADD COLUMN "canceledAt" TIMESTAMP(3);
ALTER TABLE "CrewSession" ADD COLUMN "public" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "CrewSession" ADD COLUMN "presenterMemberId" TEXT;
ALTER TABLE "CrewSession" ADD COLUMN "recordingId" TEXT;
ALTER TABLE "CrewSession" ADD COLUMN "recordingUrl" TEXT;
ALTER TABLE "CrewSession" ADD COLUMN "updatedBy" TEXT;
ALTER TABLE "CrewSession" ADD COLUMN "proposedBy" TEXT;

CREATE INDEX "CrewSession_startsAt_idx" ON "CrewSession"("startsAt");
