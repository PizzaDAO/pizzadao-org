// app/lib/trivia/admin.ts
//
// What /trivia start and /trivia skip do (the Discord side checks that the caller is an admin first). Both only work
// while the loop is live (production, trivia.enabled on) and both use the configured trivia channel, never the
// channel the command was typed in.
import type { LeaderboardRow, ReportLatestResult, StartOutcome } from "@/app/lib/discord-interactions/trivia-command";
import { resolveTriviaChannel, triviaSettings } from "./channel";
import { getLeaderboard } from "./leaderboard";
import { fetchMemberIdByDiscordId } from "@/app/lib/sheets/member-repository";
import { getQuestion } from "./bank";
import { accountOldEnough } from "./config";
import { latestAskedRound, recordReport } from "./reports";
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

/**
 * /trivia report: report the most recent round's question for this member (one report per member per question). Same
 * rule as the flag reaction: an onboarded member on an account at least 7 days old.
 */
export async function reportLatestQuestion(discordId: string, reason: string | undefined): Promise<ReportLatestResult> {
  const round = await latestAskedRound();
  const q = round ? await getQuestion(round.questionId) : undefined;
  if (!round || !q) return { status: "none" };
  const now = new Date();
  if (!accountOldEnough(discordId, now) || !(await fetchMemberIdByDiscordId(discordId))) return { status: "not_member" };
  const out = await recordReport({ questionId: q.id, discordId, text: reason ? `/trivia report: ${reason}` : "reported with /trivia report", now, eligible: true });
  return { status: out.status === "duplicate" ? "duplicate" : "reported", question: q.question } as ReportLatestResult;
}
