// app/lib/trivia/channel.ts
//
// Which channel trivia runs in. Snax's decision (plans/done/trivia.md section 13): the existing #work channel, no new
// channel; he plans to rename it. So the channel is an ID, never a name:
//   1. the saved `trivia.channelId` setting;
//   2. else the mission review channel, resolved the way the mission cards resolve it (saved id, else
//      MISSION_REVIEW_CHANNEL_ID, else the channel named "work"), and then saved into `trivia.channelId`.
// Both saves happen through pinChannelId (insert-only, production-only), so after the first lookup everything goes
// by id and a rename changes nothing. Nothing here sets channel permissions or slowmode.
import { loadSettings } from "@/app/lib/settings";
import { pinChannelId, resolveConfiguredChannelDetailed, savedChannelId } from "@/app/lib/settings/channels";

export async function resolveTriviaChannel(): Promise<string | null> {
  const saved = await savedChannelId("trivia.channelId");
  if (saved) return saved;
  const { id, trusted } = await resolveConfiguredChannelDetailed("discord.missionReviewChannelId", "work", "MISSION_REVIEW_CHANNEL_ID");
  // Only an id that is saved, from env, or an exact "work" match is saved as the trivia channel: a suffix match
  // (some other "...-work" channel) is used but never made permanent, and never the place where answers are paid.
  if (id && trusted) await pinChannelId("trivia.channelId", id);
  return id;
}

/** The effective trivia settings in one read (cached ~30 s). */
export async function triviaSettings(env: Record<string, string | undefined> = process.env): Promise<{ rewardPep: number; webDailyRewardPep: number; dryRun: boolean; roundsPerDay: number }> {
  const s = await loadSettings();
  // Dry run (nothing paid) wins whenever there is doubt: the env var on, a saved on, or settings that could not be read.
  const dryRun = s.readFailed || s.get("trivia.dryRun") || ["1", "true", "on", "yes"].includes((env.TRIVIA_DRY_RUN ?? "").trim().toLowerCase());
  return { rewardPep: s.get("trivia.rewardPep"), webDailyRewardPep: s.readFailed ? 0 : s.get("trivia.webDailyRewardPep"), dryRun, roundsPerDay: s.get("trivia.roundsPerDay") };
}
