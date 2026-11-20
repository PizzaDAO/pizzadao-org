// POST "suggest a question" -> a TriviaReport row with kind = "suggestion", reviewed in /admin/trivia.
// Discord-signed-in members only (the same session as the daily). 5 suggestions per member per day (stored count), plus a
// per-IP / per-member burst limit. A suggestion is never served: an admin turns it into a bank entry by PR.
import { NextRequest } from "next/server";
import { getSession } from "@/app/lib/session";
import { rejectUnsafeWrite } from "@/app/lib/admin-guard";
import { checkKeyedRateLimit, enforceRateLimit, rateLimitResponse } from "@/app/lib/rate-limit";
import { reply, withNoStore } from "@/app/lib/trivia/api";
import { submitSuggestion, suggestionsRemaining } from "@/app/lib/trivia/suggestions";
import { SUGGESTIONS_PER_DAY } from "@/app/lib/trivia/suggestion-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whether the visitor is signed in and how many suggestions they have left today (the form's header). */
export async function GET(request: NextRequest) {
  const limited = await enforceRateLimit(request, "trivia-read");
  if (limited) return withNoStore(limited);
  const session = await getSession();
  if (!session?.discordId) return reply({ signedIn: false });
  return reply({ signedIn: true, remaining: await suggestionsRemaining(session.discordId), limit: SUGGESTIONS_PER_DAY });
}

export async function POST(request: NextRequest) {
  const unsafe = rejectUnsafeWrite(request);
  if (unsafe) return unsafe;
  const limited = await enforceRateLimit(request, "trivia-suggest");
  if (limited) return withNoStore(limited);
  const session = await getSession();
  if (!session?.discordId) return reply({ error: "Sign in with Discord to suggest a question", code: "SIGN_IN" }, 401);
  const memberLimit = await checkKeyedRateLimit("trivia-suggest", session.discordId);
  if (!memberLimit.success) return withNoStore(rateLimitResponse(memberLimit));

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return reply({ error: "Send a JSON body", code: "INVALID" }, 400);

  try {
    const r = await submitSuggestion(session.discordId, { question: body.question, answer: body.answer, aliases: body.aliases, source: body.source, category: body.category });
    if (r.status === "invalid") return reply({ error: "Check the form", code: "INVALID", field: r.field }, 400);
    if (r.status === "limit") return reply({ error: `You can suggest ${SUGGESTIONS_PER_DAY} questions a day. Try again tomorrow.`, code: "LIMIT", limit: SUGGESTIONS_PER_DAY }, 429);
    return reply({ ok: true });
  } catch (e) {
    console.error("[trivia] suggestion not saved:", (e as Error).message);
    return reply({ error: "Could not save your suggestion right now. Please try again later.", code: "UNAVAILABLE" }, 503);
  }
}
