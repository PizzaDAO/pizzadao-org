-- Nearby pizza-party invites (plans/pineapple-84122.md). Additive only.
-- Invites are opt-out: nearbyEvents defaults to true, so existing rows and members with no row are invited
-- once the (off by default) reminders.nearbyEventsEnabled switch is turned on.

-- AlterEnum
ALTER TYPE "ReminderKind" ADD VALUE 'NEARBY_EVENT';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'NEARBY_EVENT';

-- AlterTable
ALTER TABLE "ReminderPref" ADD COLUMN "nearbyEvents" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "nearbyRadiusKm" INTEGER;
