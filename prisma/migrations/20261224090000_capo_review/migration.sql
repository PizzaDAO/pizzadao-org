-- Capo review (plans/capo-review.md, phase 0). Purely additive: three nullable columns on "CallRecording", two new tables.
-- Nothing reads or writes them yet (phase 1+).

-- AlterTable
ALTER TABLE "CallRecording" ADD COLUMN     "reviewHoldAt" TIMESTAMP(3),
ADD COLUMN     "reviewHoldBy" TEXT,
ADD COLUMN     "reviewHoldNote" TEXT;

-- CreateTable
CREATE TABLE "CallReviewCard" (
    "recordingId" TEXT NOT NULL,
    "channelId" TEXT,
    "messageId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "renderedHash" VARCHAR(64),
    "resolvedAt" TIMESTAMP(3),
    "error" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallReviewCard_pkey" PRIMARY KEY ("recordingId")
);

-- CreateTable
CREATE TABLE "CallReviewEvent" (
    "id" SERIAL NOT NULL,
    "recordingId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "via" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallReviewEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CallReviewEvent_recordingId_createdAt_idx" ON "CallReviewEvent"("recordingId", "createdAt");

-- CreateIndex
CREATE INDEX "CallReviewEvent_actorId_createdAt_idx" ON "CallReviewEvent"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "CallReviewCard" ADD CONSTRAINT "CallReviewCard_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "CallRecording"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallReviewEvent" ADD CONSTRAINT "CallReviewEvent_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "CallRecording"("id") ON DELETE CASCADE ON UPDATE CASCADE;
