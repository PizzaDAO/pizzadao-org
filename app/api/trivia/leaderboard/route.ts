// GET the trivia leaderboard: Discord wins (all-time / this month) and daily streaks. Top 25 each.
// Public and the same for everyone, so the CDN may hold it for a minute. Never carries a Discord id.
import { NextRequest } from "next/server";
import { enforceRateLimit } from "@/app/lib/rate-limit";
import { getLeaderboard } from "@/app/lib/trivia/leaderboard";
import { reply, withNoStore } from "@/app/lib/trivia/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const limited = await enforceRateLimit(request, "trivia-read");
  if (limited) return withNoStore(limited);
  const board = await getLeaderboard();
  // An unavailable board (tables missing) must not be cached for long.
  const cache = board.available ? "public, s-maxage=60, stale-while-revalidate=300" : "public, s-maxage=10";
  return reply(board, 200, { "Cache-Control": cache });
}
