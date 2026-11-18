// POST "report a problem with this question" -> a TriviaReport row, visible read-only in /admin/trivia.
// Open to logged-out visitors (the Discord id is stored when there is a session); per-IP rate limited.
import { NextRequest } from "next/server";
import { prisma } from "@/app/lib/db";
import { getSession } from "@/app/lib/session";
import { rejectUnsafeWrite } from "@/app/lib/admin-guard";
import { checkKeyedRateLimit, enforceRateLimit, rateLimitResponse } from "@/app/lib/rate-limit";
import { servable } from "@/app/lib/trivia/bank";
import { reply, withNoStore } from "@/app/lib/trivia/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPORT_MIN = 3;
const REPORT_MAX = 500;

export async function POST(request: NextRequest) {
  const unsafe = rejectUnsafeWrite(request);
  if (unsafe) return unsafe;
  const limited = await enforceRateLimit(request, "trivia-report");
  if (limited) return withNoStore(limited);
  const session = await getSession();
  if (session?.discordId) {
    const memberLimit = await checkKeyedRateLimit("trivia-report", session.discordId);
    if (!memberLimit.success) return withNoStore(rateLimitResponse(memberLimit));
  }

  const body = (await request.json().catch(() => null)) as { questionId?: unknown; text?: unknown } | null;
  const questionId = typeof body?.questionId === "string" ? body.questionId : "";
  const text = typeof body?.text === "string" ? body.text.replace(/\s+/g, " ").trim() : "";
  if (!questionId || text.length < REPORT_MIN || text.length > REPORT_MAX) {
    return reply({ error: `Tell us what is wrong (${REPORT_MIN} to ${REPORT_MAX} characters)` }, 400);
  }
  // Only a question the web actually serves can be reported (that is all anyone has seen).
  if (!servable({ pool: "web" }).some((q) => q.id === questionId)) return reply({ error: "Unknown question" }, 404);

  try {
    await prisma.triviaReport.create({ data: { questionId, discordId: session?.discordId ?? null, text } });
  } catch (e) {
    console.error("[trivia] report not saved:", (e as Error).message);
    return reply({ error: "Could not save your report right now. Please try again later." }, 503);
  }
  return reply({ ok: true });
}
