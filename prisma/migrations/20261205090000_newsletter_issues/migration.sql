-- Additive: newsletter issues (phase 2), the per-recipient send log (unused until phase 4) and the issue audit trail.

-- CreateTable
CREATE TABLE "NewsletterIssue" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "issueDate" TIMESTAMP(3) NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "subject" TEXT NOT NULL DEFAULT '',
    "preheader" TEXT NOT NULL DEFAULT '',
    "sections" JSONB NOT NULL,
    "sources" JSONB,
    "xSpaceUrl" TEXT,
    "model" TEXT,
    "generatedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "editedBy" TEXT,
    "editedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "contentHash" TEXT,
    "sponsorNotified" BOOLEAN NOT NULL DEFAULT false,
    "sendAfter" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "recipientCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NewsletterIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsletterSend" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "subscriberId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENDING',
    "resendId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "NewsletterSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsletterIssueEvent" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsletterIssueEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NewsletterIssue_slug_key" ON "NewsletterIssue"("slug");

-- CreateIndex
CREATE INDEX "NewsletterIssue_status_periodEnd_idx" ON "NewsletterIssue"("status", "periodEnd");

-- CreateIndex
CREATE INDEX "NewsletterSend_issueId_status_idx" ON "NewsletterSend"("issueId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "NewsletterSend_issueId_subscriberId_key" ON "NewsletterSend"("issueId", "subscriberId");

-- CreateIndex
CREATE INDEX "NewsletterIssueEvent_issueId_createdAt_idx" ON "NewsletterIssueEvent"("issueId", "createdAt");

-- AddForeignKey
ALTER TABLE "NewsletterSend" ADD CONSTRAINT "NewsletterSend_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "NewsletterIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsletterIssueEvent" ADD CONSTRAINT "NewsletterIssueEvent_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "NewsletterIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

