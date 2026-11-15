-- Lane cards -> guide (plans/lane-cards-mission-onboarding.md). Additive only.

CREATE TABLE "Lane" (
    "slug" VARCHAR(32) NOT NULL,
    "tag" VARCHAR(24) NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "summary" VARCHAR(280) NOT NULL,
    "missionId" INTEGER,
    "stretchMissionIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "crewId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "Lane_pkey" PRIMARY KEY ("slug")
);

CREATE TABLE "LaneStep" (
    "id" TEXT NOT NULL,
    "laneSlug" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "body" TEXT NOT NULL,
    "linkHref" VARCHAR(300),
    "linkLabel" VARCHAR(60),
    "kind" TEXT NOT NULL DEFAULT 'do',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaneStep_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MemberLane" (
    "discordId" TEXT NOT NULL,
    "laneSlug" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "doneStepIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pinnedAt" TIMESTAMP(3),
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberLane_pkey" PRIMARY KEY ("discordId","laneSlug")
);

CREATE INDEX "LaneStep_laneSlug_position_idx" ON "LaneStep"("laneSlug", "position");

CREATE INDEX "MemberLane_discordId_pinnedAt_idx" ON "MemberLane"("discordId", "pinnedAt");

ALTER TABLE "LaneStep" ADD CONSTRAINT "LaneStep_laneSlug_fkey" FOREIGN KEY ("laneSlug") REFERENCES "Lane"("slug") ON DELETE CASCADE ON UPDATE CASCADE;
