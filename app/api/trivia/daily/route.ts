// GET today's web daily question (public view only); POST an answer.
//
// Answer secrecy (plans/trivia.md §8): GET never carries the answer, aliases or rejects. They come back (answer,
// explanation, sources) only in the response to an attempt, or in GET once the signed-in member has already attempted.
// The daily is drawn from the web pool only, so nothing here can leak a Discord question.
//
// Signed in (Discord session): one attempt per UTC day, recorded for the streak and leaderboard.
// Logged out: can answer for fun; they get only correct/wrong (no answer text: that waits for a recorded attempt) and
// nothing is recorded.
//
// The client sends the dayKey and questionId it was shown; if the day rolled over (or the question was pulled) since,
// the answer is refused with 409 and nothing is recorded, so it is never graded against a question the member did not see.
import { NextRequest } from "next/server";
import { getSession } from "@/app/lib/session";
import { rejectUnsafeWrite } from "@/app/lib/admin-guard";
import { checkKeyedRateLimit, enforceRateLimit, rateLimitResponse } from "@/app/lib/rate-limit";
import { publicView, reveal } from "@/app/lib/trivia/bank";
import { match } from "@/app/lib/trivia/match";
import { nextDayStartMs } from "@/app/lib/trivia/daily";
import { MAX_ANSWER_INPUT, readAnswer, reply, withNoStore } from "@/app/lib/trivia/api";
import { findDailyAttempt, getDailyRound, percentCorrect, recordDailyAttempt, streakStatsFor } from "@/app/lib/trivia/web";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Current and best streak, as the daily's response fields. */
async function streakFields(discordId: string, dayKey: string) {
  const s = await streakStatsFor(discordId, dayKey);
  return { streak: s.current, bestStreak: s.best };
}

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

  const stats = await streakStatsFor(session.discordId, round.dayKey);
  const streak = stats.current;
  const bestStreak = stats.best;
  const mine = round.roundId ? await findDailyAttempt(round.roundId, session.discordId) : null;
  if (!mine) return reply({ ...base, streak, bestStreak, attempt: null });
  return reply({
    ...base,
    streak,
    bestStreak,
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
  const shown = body && typeof body === "object" ? (body as { dayKey?: unknown; questionId?: unknown }) : {};
  if (answer === null || typeof shown.dayKey !== "string" || typeof shown.questionId !== "string") {
    return reply({ error: `Send {"answer": "...", "dayKey": "...", "questionId": "..."} (answer max ${MAX_ANSWER_INPUT} characters)` }, 400);
  }

  const session = await getSession();
  if (session?.discordId) {
    const memberLimit = await checkKeyedRateLimit("trivia-daily", session.discordId);
    if (!memberLimit.success) return withNoStore(rateLimitResponse(memberLimit));
  }

  const round = await getDailyRound();
  if (!round) return reply({ error: "No daily question today" }, 503);
  const q = round.question;
  const discordId = session?.discordId;
  if (shown.dayKey !== round.dayKey || shown.questionId !== q.id) {
    return reply({ error: "The daily question changed. Reloading.", code: "STALE_QUESTION", dayKey: round.dayKey }, 409);
  }

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
      ...(await streakFields(discordId, round.dayKey)),
    });
  };
  const prior = await already();
  if (prior) return prior;

  const { verdict } = match(q, answer);
  if (verdict === "ignore") return reply({ verdict: "ignore" });
  // Logged out: nothing is recorded, so nothing is revealed. Only a recorded attempt gets the answer text.
  if (!discordId) return reply({ verdict, alreadyAnswered: false, recorded: false, signInToReveal: true });

  let recorded = false;
  if (round.roundId) {
    recorded = await recordDailyAttempt(round.roundId, discordId, verdict === "correct", answer);
    if (!recorded) {
      // A concurrent submit won the race: report that attempt, not this one.
      const raced = await already();
      if (raced) return raced;
    }
  }
  // Not recorded (the tables are unavailable): the member gets the verdict but not the answer, which would
  // otherwise be free to retry for. The answer text only ever goes with a recorded attempt.
  if (!recorded) return reply({ verdict, alreadyAnswered: false, recorded: false });
  return reply({
    verdict,
    alreadyAnswered: false,
    recorded: true,
    reveal: reveal(q),
    percentCorrect: round.roundId ? await percentCorrect(round.roundId) : null,
    ...(await streakFields(discordId, round.dayKey)),
  });
}
