-- Additive: a host's stream link override for a live call (separate from the already applied live-session migration).
ALTER TABLE "CallLiveSession" ADD COLUMN IF NOT EXISTS "streamLinkOverride" TEXT;
