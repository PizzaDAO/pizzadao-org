-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'VOUCH_REQUEST';

-- CreateIndex
CREATE INDEX "Notification_actorId_type_createdAt_idx" ON "Notification"("actorId", "type", "createdAt");
