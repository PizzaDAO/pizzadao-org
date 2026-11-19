// GET /api/trivia/discord/state: is a trivia round open right now? `Authorization: Bearer $RECORDER_API_KEY`.
// The recorder polls this every few seconds while trivia is enabled and forwards channel messages only while a round
// is open, so the rest of the time ordinary #work chat never leaves the recorder. One indexed query, no Discord call
// once the channel id is saved. Answers {ok:true, open:boolean, messageId, recentMessageIds}; open is false on previews and while trivia is off.
import { NextResponse } from "next/server";
import { isRecorderAuthorized } from "@/app/lib/calls/recorder-auth";
import { internalError } from "@/app/lib/errors/error-response";
import { reply } from "@/app/lib/trivia/api";
import { triviaLive } from "@/app/lib/trivia/enabled";
import { resolveTriviaChannel } from "@/app/lib/trivia/channel";
import { findOpenRound } from "@/app/lib/trivia/rounds";
import { recentQuestionPosts } from "@/app/lib/trivia/reports";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  if (!isRecorderAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    if (!(await triviaLive())) return reply({ ok: true, open: false, recentMessageIds: [] });
    const channelId = await resolveTriviaChannel();
    if (!channelId) return reply({ ok: true, open: false, recentMessageIds: [] });
    const round = await findOpenRound(channelId);
    // messageId: the question post, so the recorder forwards pick reactions on that message only.
    // recentMessageIds: question posts of the last 7 days, so it also forwards flag reactions and report replies on them
    // when no round is open.
    return reply({ ok: true, open: !!round, channelId, messageId: round?.messageId ?? null, recentMessageIds: await recentQuestionPosts(channelId) });
  } catch (err) {
    return internalError(err, "trivia/discord/state", "Could not read the trivia state");
  }
}
