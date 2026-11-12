-- CreateTable
CREATE TABLE "CrewTaskUpdatePost" (
    "crewId" TEXT NOT NULL,
    "lastEventId" INTEGER NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrewTaskUpdatePost_pkey" PRIMARY KEY ("crewId")
);
