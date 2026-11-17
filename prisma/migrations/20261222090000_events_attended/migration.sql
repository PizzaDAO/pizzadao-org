-- Events attended on profiles. Additive: new columns (defaulted or nullable) and two new tables.
ALTER TABLE "MemberProfileExtras" ADD COLUMN "eventsVisibility" VARCHAR(8) NOT NULL DEFAULT 'public', ADD COLUMN "rsvLinkedEmailHash" VARCHAR(64), ADD COLUMN "rsvLinkedAt" TIMESTAMP(3);

CREATE TABLE "MemberRsvEvent" (
    "id" SERIAL NOT NULL,
    "memberId" TEXT NOT NULL,
    "rsvEventId" VARCHAR(100) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "date" TIMESTAMP(3),
    "city" VARCHAR(120),
    "url" VARCHAR(300),
    "matchedBy" VARCHAR(16) NOT NULL,
    "guestListHidden" BOOLEAN NOT NULL DEFAULT false,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberRsvEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MemberRsvCheck" (
    "memberId" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberRsvCheck_pkey" PRIMARY KEY ("memberId")
);

CREATE UNIQUE INDEX "MemberRsvEvent_memberId_rsvEventId_key" ON "MemberRsvEvent"("memberId", "rsvEventId");
CREATE INDEX "MemberRsvEvent_memberId_idx" ON "MemberRsvEvent"("memberId");

CREATE TABLE "RsvLinkJti" (
    "jti" VARCHAR(200) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RsvLinkJti_pkey" PRIMARY KEY ("jti")
);

CREATE INDEX "RsvLinkJti_expiresAt_idx" ON "RsvLinkJti"("expiresAt");
