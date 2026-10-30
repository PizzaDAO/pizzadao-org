// app/api/telegram/host-match/confirm/route.ts
//
// POST { token }: the Telegram side of the two-sided confirmation (plans/telegram-shared-bot.md, part 4).
// The token is the signed link the shared bot DMed to the suggested Telegram account; it only counts for
// the member whose Discord session posts it, and only on this explicit POST (the page itself never
// changes anything). There is no GET, so link previews cannot confirm anything.

import { NextResponse } from "next/server";
import { rejectUnsafeWrite } from "@/app/lib/admin-guard";
import { requireSession } from "@/app/lib/auth-guards";
import { checkKeyedRateLimit, rateLimitResponse } from "@/app/lib/rate-limit";
import { completeConfirmation } from "@/app/lib/telegram/host-match-consent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function POST(req: Request) {
    const unsafe = rejectUnsafeWrite(req);
    if (unsafe) return unsafe;
    const auth = await requireSession();
    if (!auth.ok) return auth.response;

    const limited = await checkKeyedRateLimit("telegram-host-match", auth.session.discordId);
    if (!limited.success) return rateLimitResponse(limited);

    const body = (await req.json().catch(() => null)) as { token?: unknown } | null;
    if (typeof body?.token !== "string") return NextResponse.json({ ok: false, reason: "invalid" }, { status: 400, headers: NO_STORE });

    const r = await completeConfirmation(body.token, auth.session.discordId).catch(() => null);
    if (!r) return NextResponse.json({ ok: false, reason: "error" }, { status: 500, headers: NO_STORE });
    if (r.ok) return NextResponse.json({ ok: true }, { headers: NO_STORE });
    const status = r.reason === "invalid" || r.reason === "expired" ? 400 : r.reason === "wrong-account" ? 403 : r.reason === "unavailable" ? 503 : 409;
    return NextResponse.json({ ok: false, reason: r.reason }, { status, headers: NO_STORE });
}
