// Practice: GET up to 10 random questions (public view only); POST {questionId, answer} to check one.
//
// Practice draws from the *web* pool only (questions reserved for Discord rounds are never served here), so the
// reveal after an attempt cannot be used to farm Discord answers. GET never carries answer/aliases/rejects.
// Checks are server-side and rate limited (30/min per IP, and per member when signed in).
import { NextRequest } from "next/server";
import { getSession } from "@/app/lib/session";
import { rejectUnsafeWrite } from "@/app/lib/admin-guard";
import { checkKeyedRateLimit, enforceRateLimit, rateLimitResponse } from "@/app/lib/rate-limit";
import { getQuestion, publicView, reveal, servable } from "@/app/lib/trivia/bank";
import { categoryCounts, pickPractice } from "@/app/lib/trivia/daily";
import { match } from "@/app/lib/trivia/match";
import { CATEGORIES, type TriviaCategory } from "@/app/lib/trivia/schema";
import { MAX_ANSWER_INPUT, readAnswer, reply, withNoStore } from "@/app/lib/trivia/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const limited = await enforceRateLimit(request, "trivia-read");
  if (limited) return withNoStore(limited);

  const pool = servable({ pool: "web" });
  const raw = request.nextUrl.searchParams.get("category");
  const category = raw && (CATEGORIES as readonly string[]).includes(raw) ? (raw as TriviaCategory) : null;
  if (raw && raw !== "all" && !category) return reply({ error: "Unknown category" }, 400);

  return reply({
    categories: categoryCounts(pool),
    questions: pickPractice(pool, { category, count: 10 }).map(publicView),
  });
}

export async function POST(request: NextRequest) {
  const unsafe = rejectUnsafeWrite(request);
  if (unsafe) return unsafe;
  const limited = await enforceRateLimit(request, "trivia-practice");
  if (limited) return withNoStore(limited);
  const session = await getSession();
  if (session?.discordId) {
    const memberLimit = await checkKeyedRateLimit("trivia-practice", session.discordId);
    if (!memberLimit.success) return withNoStore(rateLimitResponse(memberLimit));
  }

  const body = await request.json().catch(() => null);
  const answer = readAnswer(body);
  const questionId = body && typeof body === "object" ? (body as { questionId?: unknown }).questionId : null;
  if (answer === null || typeof questionId !== "string") {
    return reply({ error: `Send {"questionId": "...", "answer": "..."} (answer max ${MAX_ANSWER_INPUT} characters)` }, 400);
  }

  // Only a question that is currently served on the web can be checked: not a Discord one, not a held-back one.
  const q = getQuestion(questionId);
  if (!q || !servable({ pool: "web" }).some((s) => s.id === q.id)) return reply({ error: "Unknown question" }, 404);

  const { verdict } = match(q, answer);
  if (verdict === "ignore") return reply({ verdict: "ignore" });
  return reply({ verdict, reveal: reveal(q) });
}
