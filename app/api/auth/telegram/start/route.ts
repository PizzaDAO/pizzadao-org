// app/api/auth/telegram/start/route.ts
//
// "Sign in with Telegram" (plans/calzone-93434.md), step 1 of 3 (the bot confirms, /status signs in).
//   GET    -> { enabled }: whether /login should offer the button. While a tester allowlist is set, only
//             ?forced=1 (from /login?telegram=1) says yes.
//   POST   -> make a request: { url, matchNumber, expiresInSeconds }, and an httpOnly cookie that only this
//             browser holds. Body: { returnTo? }. 5 per 10 minutes per IP. Production only (previews share the
//             production database, so they answer 503).
//   DELETE -> "Stop waiting": drop this browser's pending request.
// Never creates a session and never touches a linked Telegram account.

import { NextResponse } from "next/server";
import { rejectUnsafeWrite } from "@/app/lib/admin-guard";
import { enforceRateLimit } from "@/app/lib/rate-limit";
import { getSessionCookieOptions } from "@/app/lib/session";
import { readRequestCookie } from "@/app/lib/magic-login-pending";
import { telegramConfig } from "@/app/lib/telegram-auth";
import { cancelSignin, createSigninRequest, SIGNIN_COOKIE, SIGNIN_COOKIE_PATH, SIGNIN_START_PREFIX } from "@/app/lib/telegram/signin-code";
import { signinConfig } from "@/app/lib/telegram/signin-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

function cookieOptions(req: Request, maxAge: number) {
    return { ...getSessionCookieOptions(req), path: SIGNIN_COOKIE_PATH, maxAge };
}

export async function GET(req: Request) {
    const cfg = await signinConfig();
    const forced = new URL(req.url).searchParams.get("forced") === "1";
    const enabled = cfg.enabled && !!telegramConfig() && (cfg.allowlist.length === 0 || forced);
    return NextResponse.json({ enabled }, { headers: NO_STORE });
}

export async function POST(req: Request) {
    const unsafe = rejectUnsafeWrite(req);
    if (unsafe) return unsafe;
    const limited = await enforceRateLimit(req, "telegram-signin-start");
    if (limited) return limited;

    const cfg = await signinConfig();
    const bot = telegramConfig();
    if (!cfg.enabled || !bot) return NextResponse.json({ status: "disabled" }, { status: 404, headers: NO_STORE });
    if (process.env.VERCEL_ENV !== "production") {
        return NextResponse.json({ status: "unavailable" }, { status: 503, headers: NO_STORE });
    }

    const body = (await req.json().catch(() => null)) as { returnTo?: unknown } | null;
    const created = await createSigninRequest({ returnTo: body?.returnTo, ttlMinutes: cfg.ttlMinutes });
    const expiresInSeconds = Math.max(1, Math.round((created.expiresAt.getTime() - Date.now()) / 1000));
    const res = NextResponse.json(
        {
            url: `https://t.me/${bot.botUsername}?start=${SIGNIN_START_PREFIX}${created.code}`,
            matchNumber: created.matchNumber,
            expiresInSeconds,
        },
        { headers: NO_STORE },
    );
    res.cookies.set(SIGNIN_COOKIE, created.cookieValue, cookieOptions(req, expiresInSeconds + 60));
    return res;
}

export async function DELETE(req: Request) {
    const unsafe = rejectUnsafeWrite(req);
    if (unsafe) return unsafe;
    try {
        await cancelSignin(readRequestCookie(req, SIGNIN_COOKIE));
    } catch {
        // Best effort: the request expires on its own.
    }
    const res = NextResponse.json({ ok: true }, { headers: NO_STORE });
    res.cookies.set(SIGNIN_COOKIE, "", cookieOptions(req, 0));
    return res;
}
