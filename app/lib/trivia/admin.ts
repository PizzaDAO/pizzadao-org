// app/lib/trivia/admin.ts
//
// What /trivia start and /trivia skip do (the Discord side checks that the caller is an admin first). Both only work
// while the loop is live (production, trivia.enabled on) and both use the configured trivia channel, never the
// channel the command was typed in.
import type { LeaderboardRow, StartOutcome } from "@/app/lib/discord-interactions/trivia-command";
import { resolveTriviaChannel, triviaSettings } from "./channel";
import { getLeaderboard } from "./leaderboard";
import { cancelOpenRound, defaultPostDeps, expireRounds, openDiscordRound, type PostDeps } from "./rounds";

export async function adminStartRound(deps: PostDeps = defaultPostDeps): Promise<StartOutcome> {
  const channelId = await resolveTriviaChannel();
  if (!channelId) return { status: "no_channel" };
  // Close anything past its time first, so a finished-but-unswept round does not block a new one.
  await expireRounds(new Date(), deps);
  const { rewardPep, dryRun } = await triviaSettings();
  const r = await openDiscordRound({ channelId, rewardPep: dryRun ? 0 : rewardPep }, deps);
  return r.ok ? { status: "started", channelId } : { status: r.reason };
}

export async function adminSkipRound(deps: PostDeps = defaultPostDeps): Promise<"cancelled" | "none_open" | "no_channel"> {
  const channelId = await resolveTriviaChannel();
  if (!channelId) return "no_channel";
  return (await cancelOpenRound(channelId, deps)) ? "cancelled" : "none_open";
}

export async function discordLeaderboard(): Promise<{ available: boolean; month: LeaderboardRow[]; allTime: LeaderboardRow[] }> {
  const lb = await getLeaderboard();
  const pick = (list: { rank: number; name: string; score: number }[]) => list.map((e) => ({ rank: e.rank, name: e.name, score: e.score }));
  return { available: lb.available, month: pick(lb.wins.month), allTime: pick(lb.wins.allTime) };
}
