// GET today's web daily question (public view only); POST an answer.
//
// Answer secrecy (plans/trivia.md §8): GET never carries the answer, aliases or rejects. They come back (answer,
// explanation, sources) only in the response to an attempt, or in GET once the signed-in member has already attempted.
// The daily is drawn from the web pool only, so nothing here can leak a Discord question.
//
// Signed in (Discord session): one attempt per UTC day, recorded for the streak and leaderboard.
// Logged out: can answer for fun; nothing is recorded.
import { NextRequest } from "next/server";
import { getSession } from "@/app/lib/session";
import { rejectUnsafeWrite } from "@/app/lib/admin-guard";
import { checkKeyedRateLimit, enforceRateLimit, rateLimitResponse } from "@/app/lib/rate-limit";
import { publicView, reveal } from "@/app/lib/trivia/bank";
import { match } from "@/app/lib/trivia/match";
import { nextDayStartMs } from "@/app/lib/trivia/daily";
import { MAX_ANSWER_INPUT, readAnswer, reply, withNoStore } from "@/app/lib/trivia/api";
import { findDailyAttempt, getDailyRound, percentCorrect, recordDailyAttempt, streakFor } from "@/app/lib/trivia/web";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const limited = await enforceRateLimit(request, "trivia-read");
  if (limited) return withNoStore(limited);

  const round = await getDailyRound();
  if (!round) return reply({ error: "No daily question today" }, 503);

  const session = await getSession();
  const base = {
    dayKey: round.dayKey,
    resetsAt: new Date(nextDayStartMs(round.dayKey)).toISOString(),
    signedIn: !!session?.discordId,
    question: publicView(round.question),
  };
  if (!session?.discordId) return reply({ ...base, attempt: null });

  const streak = await streakFor(session.discordId, round.dayKey);
  const mine = round.roundId ? await findDailyAttempt(round.roundId, session.discordId) : null;
  if (!mine) return reply({ ...base, streak, attempt: null });
  return reply({
    ...base,
    streak,
    attempt: {
      correct: mine.correct,
      reveal: reveal(round.question),
      percentCorrect: round.roundId ? await percentCorrect(round.roundId) : null,
    },
  });
}

export async function POST(request: NextRequest) {
  const unsafe = rejectUnsafeWrite(request);
  if (unsafe) return unsafe;
  const limited = await enforceRateLimit(request, "trivia-daily");
  if (limited) return withNoStore(limited);

  const body = await request.json().catch(() => null);
  const answer = readAnswer(body);
  if (answer === null) return reply({ error: `Send {"answer": "..."} (max ${MAX_ANSWER_INPUT} characters)` }, 400);

  const session = await getSession();
  if (session?.discordId) {
    const memberLimit = await checkKeyedRateLimit("trivia-daily", session.discordId);
    if (!memberLimit.success) return withNoStore(rateLimitResponse(memberLimit));
  }

  const round = await getDailyRound();
  if (!round) return reply({ error: "No daily question today" }, 503);
  const q = round.question;
  const discordId = session?.discordId;

  // One attempt per member per day: a second submit gets the first one's result back.
  const already = async () => {
    if (!discordId || !round.roundId) return null;
    const mine = await findDailyAttempt(round.roundId, discordId);
    if (!mine) return null;
    return reply({
      verdict: mine.correct ? "correct" : "wrong",
      alreadyAnswered: true,
      recorded: true,
      reveal: reveal(q),
      percentCorrect: await percentCorrect(round.roundId),
      streak: await streakFor(discordId, round.dayKey),
    });
  };
  const prior = await already();
  if (prior) return prior;

  const { verdict } = match(q, answer);
  if (verdict === "ignore") return reply({ verdict: "ignore" });

  let recorded = false;
  if (discordId && round.roundId) {
    recorded = await recordDailyAttempt(round.roundId, discordId, verdict === "correct", answer);
    if (!recorded) {
      // A concurrent submit won the race: report that attempt, not this one.
      const raced = await already();
      if (raced) return raced;
    }
  }
  return reply({
    verdict,
    alreadyAnswered: false,
    recorded,
    reveal: reveal(q),
    percentCorrect: recorded && round.roundId ? await percentCorrect(round.roundId) : null,
    streak: recorded && discordId ? await streakFor(discordId, round.dayKey) : null,
  });
}
