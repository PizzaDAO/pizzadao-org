// POST /api/trivia/discord/answer: one typed answer forwarded by the recorder (the Railway gateway worker).
// `Authorization: Bearer $RECORDER_API_KEY`. Everything that decides (matching, caps, the atomic claim, the payout)
// happens here; the recorder only forwards text from the trivia channel. See app/lib/trivia/answer.ts.
//
// Answers 200 {ok:true, status} for everything the recorder should NOT retry (including "off", "no round" and
// ignored chatter), 400 for a malformed body, 401 without the key, and 5xx only for a real failure (it retries those).
import { after, NextResponse } from "next/server";
import { isRecorderAuthorized } from "@/app/lib/calls/recorder-auth";
import { internalError } from "@/app/lib/errors/error-response";
import { reply } from "@/app/lib/trivia/api";
import { triviaLive } from "@/app/lib/trivia/enabled";
import { defaultAnswerDeps, processAnswer } from "@/app/lib/trivia/answer";
import { resolveTriviaChannel } from "@/app/lib/trivia/channel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SNOWFLAKE = /^\d{5,25}$/;
const MAX_CONTENT = 500;

export async function POST(request: Request): Promise<NextResponse> {
  if (!isRecorderAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { channelId?: unknown; messageId?: unknown; authorId?: unknown; content?: unknown } | null;
  const { channelId, messageId, authorId, content } = body ?? {};
  if (
    typeof channelId !== "string" || !SNOWFLAKE.test(channelId) ||
    typeof messageId !== "string" || !SNOWFLAKE.test(messageId) ||
    typeof authorId !== "string" || !SNOWFLAKE.test(authorId) ||
    typeof content !== "string"
  ) {
    return reply({ error: "channelId, messageId, authorId and content are required" }, 400);
  }

  try {
    if (!(await triviaLive())) return reply({ ok: true, status: "off" });
    // Only the trivia channel's answers count, whatever the recorder sends.
    if (channelId !== (await resolveTriviaChannel())) return reply({ ok: true, status: "no_round" });
    const outcome = await processAnswer(
      { channelId, messageId, discordId: authorId, content: content.slice(0, MAX_CONTENT) },
      defaultAnswerDeps((fn) => after(() => fn().catch((e) => console.error("[trivia] deferred post failed:", e)))),
    );
    return reply({ ok: true, ...outcome });
  } catch (err) {
    return internalError(err, "trivia/discord/answer", "Could not process the answer");
  }
}
