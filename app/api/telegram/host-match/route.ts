// app/api/telegram/host-match/route.ts
//
// The profile card for a suggested Telegram match (plans/telegram-shared-bot.md, part 4).
//
//   GET  -> { enabled, state: none|pending|awaiting|confirmed, handleHint, canSend }
//   POST { action: 'confirm' | 'send-confirmation' | 'decline' }
//
// Session-gated, 3 writes per 10 minutes per member. 'confirm' is the member's "yes, that's me" (side a):
// it records the click and has the shared bot DM a signed link to the suggested Telegram account (side b).
// The match stays unused until that link is opened and confirmed while logged in as the same member.
// The Telegram id is never returned, only a 2-character hint.

import { NextResponse } from "next/server";
import { rejectUnsafeWrite } from "@/app/lib/admin-guard";
import { requireSession } from "@/app/lib/auth-guards";
import { checkKeyedRateLimit, rateLimitResponse } from "@/app/lib/rate-limit";
import { declineMatch, getCard, startConfirmation } from "@/app/lib/telegram/host-match-consent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET() {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;
    const card = await getCard(auth.session.discordId).catch(() => null);
    if (!card) return NextResponse.json({ enabled: false, state: "none" }, { headers: NO_STORE });
    return NextResponse.json({ enabled: card.state !== "none", ...card }, { headers: NO_STORE });
}

export async function POST(req: Request) {
    const unsafe = rejectUnsafeWrite(req);
    if (unsafe) return unsafe;
    const auth = await requireSession();
    if (!auth.ok) return auth.response;
    const { discordId } = auth.session;

    const limited = await checkKeyedRateLimit("telegram-host-match", discordId);
    if (!limited.success) return rateLimitResponse(limited);

    const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
    const action = body?.action;
    if (action === "decline") {
        const declined = await declineMatch(discordId);
        return NextResponse.json({ ok: declined, state: "none" }, { status: declined ? 200 : 404, headers: NO_STORE });
    }
    if (action !== "confirm" && action !== "send-confirmation") {
        return NextResponse.json({ error: "Unknown action" }, { status: 400, headers: NO_STORE });
    }
    const result = await startConfirmation(discordId, action === "send-confirmation");
    const status = result === "not-found" ? 404 : result === "wait" || result === "has-login" ? 409 : result === "try-later" ? 503 : 200;
    return NextResponse.json({ ok: result === "sent", result, ...(await getCard(discordId).catch(() => ({ state: "none" }))) }, { status, headers: NO_STORE });
}
