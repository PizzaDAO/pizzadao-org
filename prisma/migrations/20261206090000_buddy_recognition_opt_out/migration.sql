-- Additive: per-member opt-out of public buddy recognition (default visible).
ALTER TABLE "BuddyProfile" ADD COLUMN "hideRecognition" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "BuddyPair" ADD COLUMN "traineeHideRecognition" BOOLEAN NOT NULL DEFAULT false;
