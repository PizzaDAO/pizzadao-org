-- Additive: double opt-in state for newsletter subscribers. Existing rows keep their values; they stay
-- unconfirmed (confirmedAt NULL) and are not mailable until the address is confirmed.

-- AlterTable
ALTER TABLE "NewsletterSubscriber"
    ADD COLUMN "confirmedAt" TIMESTAMP(3),
    ADD COLUMN "confirmSentAt" TIMESTAMP(3),
    ADD COLUMN "confirmSends" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "unsubscribedAt" TIMESTAMP(3),
    ADD COLUMN "memberId" TEXT,
    ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en',
    ADD COLUMN "lastStatusReason" TEXT;

-- CreateIndex
CREATE INDEX "NewsletterSubscriber_memberId_idx" ON "NewsletterSubscriber"("memberId");
