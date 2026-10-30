// app/api/telegram/account/check/route.ts
//
// POST: "Check again". Asks the rsv.pizza proxy whether the shared sender bot can message the
// logged-in member's linked Telegram account, and records the answer (TelegramReach).
// Session-gated, 3 per 10 minutes per member. On a preview deploy (or with no key) it answers
// { state: 'unknown', preview: true } without calling anything.

import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/db";
import { requireSession } from "@/app/lib/auth-guards";
import { loadFollowUpConfig } from "@/app/lib/followups/config";
import { checkKeyedRateLimit, rateLimitResponse } from "@/app/lib/rate-limit";
import { loadReach, recordResult, resetReach } from "@/app/lib/telegram/reach";
import { probe, telegramSendAllowed } from "@/app/lib/telegram/rsv-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function POST() {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;
    const { discordId } = auth.session;

    const limited = await checkKeyedRateLimit("telegram-check", discordId);
    if (!limited.success) return rateLimitResponse(limited);

    const account = await prisma.telegramAccount.findUnique({
        where: { discordId },
        select: { telegramId: true },
    });
    if (!account) {
        return NextResponse.json({ error: "Link Telegram first" }, { status: 404, headers: NO_STORE });
    }
    if (!telegramSendAllowed()) {
        return NextResponse.json({ state: "unknown", preview: true }, { headers: NO_STORE });
    }

    const cfg = await loadFollowUpConfig();
    const result = await probe(account.telegramId);
    // Only a definite answer changes anything (reset first so a fresh "not started" restarts the backoff);
    // rate limits and transient failures leave the stored state alone.
    const definite = result.reachable || result.code === "not_started" || result.code === "blocked";
    if (definite) {
        await resetReach(account.telegramId);
        await recordResult(account.telegramId, result.reachable ? "ok" : (result.code as "not_started" | "blocked"), cfg);
    }
    const reach = await loadReach(account.telegramId);
    return NextResponse.json(
        { state: (reach?.state ?? "UNKNOWN").toLowerCase(), ...(definite ? {} : { tryLater: true }) },
        { headers: NO_STORE },
    );
}
