// app/api/telegram/link/start/route.ts
//
// Start "Link with the Telegram app" (no phone number needed): returns a t.me deep link to our login bot
// carrying a single-use, 10-minute code. The webhook at /api/telegram/login-bot/webhook spends it.
// Session-gated, 5 per 10 minutes per member.

import { NextResponse } from "next/server";
import { rejectUnsafeWrite } from "@/app/lib/admin-guard";
import { requireSession } from "@/app/lib/auth-guards";
import { checkKeyedRateLimit, rateLimitResponse } from "@/app/lib/rate-limit";
import { telegramConfig } from "@/app/lib/telegram-auth";
import { createLinkCode } from "@/app/lib/telegram/link-code";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function POST(req: Request) {
    const unsafe = rejectUnsafeWrite(req);
    if (unsafe) return unsafe;
    const auth = await requireSession();
    if (!auth.ok) return auth.response;
    const { discordId } = auth.session;

    const cfg = telegramConfig();
    if (!cfg) {
        return NextResponse.json({ error: "Telegram linking is not configured" }, { status: 503, headers: NO_STORE });
    }

    const limited = await checkKeyedRateLimit("telegram-link-start", discordId);
    if (!limited.success) return rateLimitResponse(limited);

    const code = await createLinkCode(discordId);
    return NextResponse.json(
        { url: `https://t.me/${cfg.botUsername}?start=${code}`, expiresInSeconds: 600 },
        { headers: NO_STORE },
    );
}
