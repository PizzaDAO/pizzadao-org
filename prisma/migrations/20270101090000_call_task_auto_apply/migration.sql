-- Action items applied straight from a call: one row per call (the pass and its one summary message).
-- Purely additive: one new table, nothing existing changes.

-- CreateTable
CREATE TABLE "CallTaskAutoApply" (
    "recordingId" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "summaryClaimedAt" TIMESTAMP(3),
    "summaryMessageId" TEXT,
    "summaryError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallTaskAutoApply_pkey" PRIMARY KEY ("recordingId")
);
