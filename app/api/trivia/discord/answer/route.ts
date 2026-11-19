// POST /api/trivia/discord/answer: one typed answer, or (kind "reaction") one reaction on the question post, forwarded by the recorder (the Railway gateway worker).
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
import { defaultAnswerDeps, processAnswer, processReaction } from "@/app/lib/trivia/answer";
import type { ReactionEmoji } from "@/app/lib/trivia/emoji";
import { resolveTriviaChannel } from "@/app/lib/trivia/channel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SNOWFLAKE = /^\d{5,25}$/;
const MAX_CONTENT = 500;

/** `{ id: string | null, name: string | null }` with a snowflake id (or null) and a short name; anything else is null. */
function parseEmoji(v: unknown): ReactionEmoji | null {
  if (!v || typeof v !== "object") return null;
  const { id, name } = v as { id?: unknown; name?: unknown };
  const okId = id === null || id === undefined || (typeof id === "string" && SNOWFLAKE.test(id));
  const okName = name === null || name === undefined || (typeof name === "string" && name.length <= 64);
  if (!okId || !okName) return null;
  const e = { id: (id as string | null | undefined) ?? null, name: (name as string | null | undefined) ?? null };
  return e.id || e.name ? e : null;
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isRecorderAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as {
    kind?: unknown; channelId?: unknown; messageId?: unknown; authorId?: unknown; content?: unknown; emoji?: unknown; replyTo?: unknown;
  } | null;
  const { channelId, messageId, authorId, content } = body ?? {};
  const isReaction = body?.kind === "reaction";
  if (body?.kind !== undefined && !isReaction && body.kind !== "message") return reply({ error: "unknown kind" }, 400);
  const emoji = isReaction ? parseEmoji(body?.emoji) : null;
  if (
    typeof channelId !== "string" || !SNOWFLAKE.test(channelId) ||
    typeof messageId !== "string" || !SNOWFLAKE.test(messageId) ||
    typeof authorId !== "string" || !SNOWFLAKE.test(authorId) ||
    (isReaction ? emoji === null : typeof content !== "string") ||
    (body?.replyTo !== undefined && body.replyTo !== null && (typeof body.replyTo !== "string" || !SNOWFLAKE.test(body.replyTo)))
  ) {
    return reply({ error: isReaction ? "channelId, messageId, authorId and emoji are required" : "channelId, messageId, authorId and content are required" }, 400);
  }

  try {
    if (!(await triviaLive())) return reply({ ok: true, status: "off" });
    // Only the trivia channel's answers count, whatever the recorder sends.
    if (channelId !== (await resolveTriviaChannel())) return reply({ ok: true, status: "no_round" });
    const deps = defaultAnswerDeps((fn) => after(() => fn().catch((e) => console.error("[trivia] deferred post failed:", e))));
    const outcome = emoji
      ? await processReaction({ channelId, messageId, discordId: authorId, emoji }, deps)
      : await processAnswer({ channelId, messageId, discordId: authorId, content: (content as string).slice(0, MAX_CONTENT), ...(typeof body?.replyTo === "string" ? { replyTo: body.replyTo } : {}) }, deps);
    return reply({ ok: true, ...outcome });
  } catch (err) {
    return internalError(err, "trivia/discord/answer", "Could not process the answer");
  }
}
