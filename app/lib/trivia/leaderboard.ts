// app/lib/trivia/leaderboard.ts
//
// Leaderboard aggregates (plans/trivia.md §9): SQL over TriviaRound (Discord wins) and TriviaAttempt (daily streaks).
// There is no denormalised score table until it's needed. Shared by /api/trivia/leaderboard and (phase 2) /trivia leaderboard.
// Phase 1 has no Discord rounds yet, so the wins boards are empty until phase 2 ships; streaks fill from the web daily.
//
// Public output never carries a Discord id: only a display name (PizzaDAO name, else "a member") and the member id
// for the profile link.
import { prisma } from "@/app/lib/db";
import { memberNamesByDiscordId } from "@/app/lib/member-names";
import { addDays, computeStreak, dayKeyUtc } from "./daily";

export const LEADERBOARD_SIZE = 25;
/** Streaks are computed over this many days. A streak that fills the whole window is shown as "120+" (see `capped`). */
export const STREAK_LOOKBACK_DAYS = 120;
const STREAK_PAGE = 5_000;
/** Safety stop on paging (500k rows = 4,000+ daily players over the whole window). Hit it and a warning is logged. */
const STREAK_MAX_PAGES = 100;

export interface LeaderboardEntry {
  rank: number;
  name: string;
  memberId: string | null;
  /** Wins (wins boards) or days in a row (streak board). */
  score: number;
  /** Streak board only: the streak fills the whole lookback window, so the real one is at least this long ("120+"). */
  capped?: boolean;
}

export interface Leaderboard {
  /** False when the Trivia tables could not be read (not migrated yet): the page shows its empty state. */
  available: boolean;
  wins: { allTime: LeaderboardEntry[]; month: LeaderboardEntry[] };
  streaks: LeaderboardEntry[];
  generatedAt: string;
}

export function emptyLeaderboard(available: boolean, now: Date = new Date()): Leaderboard {
  return { available, wins: { allTime: [], month: [] }, streaks: [], generatedAt: now.toISOString() };
}

type Scored = { discordId: string; score: number; capped?: boolean };

/** Rank (ties share nothing special: stable by score, then first seen), names resolved in one query. */
async function toEntries(rows: Scored[]): Promise<LeaderboardEntry[]> {
  const names = await memberNamesByDiscordId(rows.map((r) => r.discordId));
  return rows.map((r, i) => ({
    rank: i + 1,
    name: names.get(r.discordId)?.name ?? "a member",
    memberId: names.get(r.discordId)?.memberId ?? null,
    score: r.score,
    ...(r.capped ? { capped: true } : {}),
  }));
}

async function winsSince(since: Date | null): Promise<Scored[]> {
  const groups = await prisma.triviaRound.groupBy({
    by: ["winnerDiscordId"],
    where: { status: "WON", winnerDiscordId: { not: null }, ...(since ? { wonAt: { gte: since } } : {}) },
    _count: { _all: true },
    orderBy: [{ _count: { winnerDiscordId: "desc" } }, { winnerDiscordId: "asc" }],
    take: LEADERBOARD_SIZE,
  });
  return groups.filter((g) => g.winnerDiscordId).map((g) => ({ discordId: g.winnerDiscordId as string, score: g._count._all }));
}

/**
 * Every web-daily attempt in the lookback window, read in id order with a cursor (a stable, complete scan: no row is
 * skipped or read twice however many there are), then streaks computed per member. Ties sort by id so the board is
 * deterministic.
 */
async function streakRows(today: string): Promise<Scored[]> {
  const since = addDays(today, -(STREAK_LOOKBACK_DAYS - 1));
  const byUser = new Map<string, string[]>();
  let cursor: number | undefined;
  for (let page = 0; page < STREAK_MAX_PAGES; page++) {
    const rows = await prisma.triviaAttempt.findMany({
      where: { messageId: null, round: { surface: "WEB_DAILY", dayKey: { gte: since } } },
      select: { id: true, discordId: true, round: { select: { dayKey: true } } },
      orderBy: { id: "asc" },
      take: STREAK_PAGE,
      ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const r of rows) {
      const k = r.round.dayKey;
      if (!k) continue;
      const list = byUser.get(r.discordId);
      if (list) list.push(k);
      else byUser.set(r.discordId, [k]);
    }
    if (rows.length < STREAK_PAGE) break;
    cursor = rows[rows.length - 1].id;
    if (page === STREAK_MAX_PAGES - 1) console.error("[trivia] streak scan hit its page cap; the board may be incomplete");
  }
  return [...byUser.entries()]
    .map(([discordId, days]) => {
      const score = computeStreak(days, today);
      return { discordId, score, capped: score >= STREAK_LOOKBACK_DAYS };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.discordId.localeCompare(b.discordId))
    .slice(0, LEADERBOARD_SIZE);
}

export async function getLeaderboard(now: Date = new Date()): Promise<Leaderboard> {
  const today = dayKeyUtc(now);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  try {
    const [allTime, month, streaks] = await Promise.all([winsSince(null), winsSince(monthStart), streakRows(today)]);
    const [a, m, s] = await Promise.all([toEntries(allTime), toEntries(month), toEntries(streaks)]);
    return { available: true, wins: { allTime: a, month: m }, streaks: s, generatedAt: now.toISOString() };
  } catch (e) {
    console.error("[trivia] leaderboard unavailable:", (e as Error).message);
    return emptyLeaderboard(false, now);
  }
}
