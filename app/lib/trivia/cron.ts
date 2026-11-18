// app/lib/trivia/cron.ts
//
// The 5-minute tick of the Discord loop (plans/trivia.md section 6): expire rounds past their time (reveal the
// answer), then open the next scheduled round if one is due and none is open.
//
// A no-op (nothing read, posted or paid) unless this is the production deployment AND trivia.enabled is on:
// previews share the production database and must never post. Everything is decided from the database, so
// repeated or overlapping ticks are harmless (see openDiscordRound for the race guards).
import { triviaLive, isProductionDeploy } from "./enabled";
import { resolveTriviaChannel, triviaSettings } from "./channel";
import { defaultPostDeps, expireRounds, findOpenRound, openDiscordRound, recentDiscordRounds, type PostDeps } from "./rounds";
import { dueSlot } from "./schedule";

export type TriviaCronResult =
  | { status: "skipped"; reason: string }
  | { status: "ok"; expired: number; opened: "none" | "opened" | "not_due" | "open_round" | "no_question" | "busy" | "post_failed"; roundId?: number; dryRun: boolean };

export async function runTriviaCron(now: Date = new Date(), deps: PostDeps = defaultPostDeps): Promise<TriviaCronResult> {
  if (!isProductionDeploy()) return { status: "skipped", reason: "discord trivia off on preview" };
  if (!(await triviaLive())) return { status: "skipped", reason: "trivia.enabled is off" };

  const channelId = await resolveTriviaChannel();
  if (!channelId) return { status: "skipped", reason: "no trivia channel (set trivia.channelId)" };

  const expired = await expireRounds(now, deps);
  if (await findOpenRound(channelId, now)) return { status: "ok", expired, opened: "open_round", dryRun: false };

  const { rewardPep, dryRun, roundsPerDay } = await triviaSettings();
  const recent = await recentDiscordRounds();
  const slot = dueSlot(now, roundsPerDay, recent.map((r) => r.openedAt.getTime()));
  if (slot === null) return { status: "ok", expired, opened: "not_due", dryRun };

  const res = await openDiscordRound({ now, channelId, rewardPep: dryRun ? 0 : rewardPep }, deps);
  if (res.ok) return { status: "ok", expired, opened: "opened", roundId: res.roundId, dryRun };
  return { status: "ok", expired, opened: res.reason === "open_exists" ? "open_round" : res.reason, dryRun };
}
