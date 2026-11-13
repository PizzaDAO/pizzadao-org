-- Additive: the random Telegram group picked for each "we're live" announcement.
ALTER TABLE "CallLiveAnnounce" ADD COLUMN "randomCityKey" TEXT;
