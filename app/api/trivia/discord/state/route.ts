// GET /api/trivia/discord/state: is a trivia round open right now? `Authorization: Bearer $RECORDER_API_KEY`.
// Also posts a round's answer on time: the first poll after a round's close expires it (production only).
// The recorder polls this every few seconds while trivia is enabled and forwards channel messages only while a round
// is open, so the rest of the time ordinary #work chat never leaves the recorder. One indexed query for the round (open vs lapsed is
// decided here), the question posts cached for 60 s per instance, no Discord call once the channel id is saved.
// Answers {ok:true, open:boolean, messageId, recentMessageIds}; open is false on previews and while trivia is off.
import { after, NextResponse } from "next/server";
import { isRecorderAuthorized } from "@/app/lib/calls/recorder-auth";
import { internalError } from "@/app/lib/errors/error-response";
import { reply } from "@/app/lib/trivia/api";
import { isProductionDeploy, triviaLive } from "@/app/lib/trivia/enabled";
import { resolveTriviaChannel } from "@/app/lib/trivia/channel";
import { expireLapsedRound, findChannelOpenRound, isLapsed } from "@/app/lib/trivia/rounds";
import { cachedRecentQuestionPosts } from "@/app/lib/trivia/reports";

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
    // A round past its close time that the cron has not expired yet still counts as open, so the first late message
    // reaches the answer route, which expires it at once (reveal now, "Too late" for a correct answer).
    const round = await findChannelOpenRound(channelId);
    const lapsed = round && isLapsed(round) ? round : null;
    // The recorder polls every few seconds, so this is where a round's answer is posted on time: the first poll after
    // the close expires it (the atomic status flip keeps it to one reveal, racing the cron and the answer route).
    if (lapsed && isProductionDeploy()) {
      after(() => expireLapsedRound(lapsed).then(() => undefined, (e) => console.error("[trivia] on-time reveal failed:", e)));
    }
    // messageId: the question post, so the recorder forwards pick reactions on that message only.
    // recentMessageIds: question posts of the last 7 days, so it also forwards flag reactions and report replies on them
    // when no round is open.
    return reply({ ok: true, open: !!round, channelId, messageId: round?.messageId ?? null, recentMessageIds: await cachedRecentQuestionPosts(channelId) });
  } catch (err) {
    return internalError(err, "trivia/discord/state", "Could not read the trivia state");
  }
}
