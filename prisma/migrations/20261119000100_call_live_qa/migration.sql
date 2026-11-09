-- Additive: live Q&A and polls of a recorded call.
CREATE TABLE "CallLiveQuestion" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT,
    "text" TEXT NOT NULL,
    "anonymous" BOOLEAN NOT NULL DEFAULT false,
    "answered" BOOLEAN NOT NULL DEFAULT false,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "CallLiveQuestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CallLiveQuestionVote" (
    "questionId" TEXT NOT NULL,
    "voterId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallLiveQuestionVote_pkey" PRIMARY KEY ("questionId","voterId")
);

CREATE TABLE "CallLivePoll" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "showResults" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT NOT NULL,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "CallLivePoll_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CallLivePollVote" (
    "pollId" TEXT NOT NULL,
    "voterId" TEXT NOT NULL,
    "optionIndex" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallLivePollVote_pkey" PRIMARY KEY ("pollId","voterId")
);

CREATE INDEX "CallLiveQuestion_sessionId_createdAt_idx" ON "CallLiveQuestion"("sessionId", "createdAt");
CREATE INDEX "CallLiveQuestion_sessionId_authorId_idx" ON "CallLiveQuestion"("sessionId", "authorId");
CREATE INDEX "CallLivePoll_sessionId_createdAt_idx" ON "CallLivePoll"("sessionId", "createdAt");

ALTER TABLE "CallLiveQuestionVote" ADD CONSTRAINT "CallLiveQuestionVote_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "CallLiveQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CallLivePollVote" ADD CONSTRAINT "CallLivePollVote_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "CallLivePoll"("id") ON DELETE CASCADE ON UPDATE CASCADE;
