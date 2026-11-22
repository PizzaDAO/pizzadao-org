// app/api/auth/telegram/status/route.ts
//
// "Sign in with Telegram" (plans/calzone-93434.md), the browser's poll (every 3 s while the number is shown).
// Answers { status }:
//   none      this browser has no request (or it was already used),
//   pending   waiting for the tap in the bot,
//   cancelled the member tapped a different number, or pressed Stop waiting,
//   expired   it ran out,
//   error     refused: { code } is telegram_left_server, telegram_privileged (holds an admin or reviewer role:
//             use Discord), telegram_not_linked (disconnected meanwhile) or telegram_unavailable,
//   approved  signed in: { href } is where to go. The session cookie is set on THIS response, once.
// The session only ever goes to the browser that holds the request's secret cookie. Reads the member's link
// but never changes it. Logs only the outcome and the Discord id (no Telegram id, no message text).

import { NextResponse } from "next/server";
import { checkKeyedRateLimit, enforceRateLimit, rateLimitResponse } from "@/app/lib/rate-limit";
import { toggleEnabled } from "@/app/lib/settings/toggles";
import { holdsPrivilegedRole } from "@/app/lib/telegram/signin-privileged";
import { setSessionCookies, getSessionCookieOptions } from "@/app/lib/session";
import { lookupGuildMembership, type GuildMembership } from "@/app/lib/discord";
import { issueLoginSession } from "@/app/lib/auth/issue-login-session";
import { loggedInLanding } from "@/app/lib/login-return";
import { marketingHomeAtRoot } from "@/app/lib/marketing-site";
import { readRequestCookie } from "@/app/lib/magic-login-pending";
import { consumeSignin, hashSigninValue, parseSigninCookie, SIGNIN_COOKIE, SIGNIN_COOKIE_PATH } from "@/app/lib/telegram/signin-code";
import { signinAllowed, signinConfig } from "@/app/lib/telegram/signin-settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

function audit(outcome: string, discordId?: string) {
    console.info(JSON.stringify({ event: "telegram_signin", outcome, ...(discordId ? { discordId } : {}) }));
}

export async function GET(req: Request) {
    const cookieValue = readRequestCookie(req, SIGNIN_COOKIE);
    // A browser with a request is limited by that request, so people behind one shared IP (an event's wifi)
    // do not use up each other's polls. Anything without one is limited per IP.
    const parsed = parseSigninCookie(cookieValue);
    if (parsed) {
        const limit = await checkKeyedRateLimit("telegram-signin-status", hashSigninValue(parsed.code));
        if (!limit.success) return rateLimitResponse(limit);
    } else {
        const limited = await enforceRateLimit(req, "telegram-signin-status");
        if (limited) return limited;
    }

    const cfg = await signinConfig();
    let membership: Extract<GuildMembership, { status: "member" }> | null = null;

    const result = await consumeSignin(cookieValue, Date.now(), async (discordId) => {
        if (!signinAllowed(cfg, discordId)) return "telegram_unavailable";
        const found = await lookupGuildMembership(discordId);
        if (found.status === "unknown") return "retry"; // Discord hiccup: try again on the next poll
        if (found.status === "not_member") return "telegram_left_server";
        // Admin, reviewer, payment and capo roles need a Discord login (unless an admin allowed otherwise).
        // The saved role lists are read fresh; if they cannot be, wait and retry rather than guess.
        const adminAllowed = await toggleEnabled("auth.telegramSignInAdminAllowed").catch(() => false);
        if (!adminAllowed) {
            try {
                if (await holdsPrivilegedRole(found.member.roles, discordId)) return "telegram_privileged";
            } catch {
                return "retry";
            }
        }
        membership = found;
        return null;
    }).catch(() => null);

    const clear = (res: NextResponse) => {
        res.cookies.set(SIGNIN_COOKIE, "", { ...getSessionCookieOptions(req), path: SIGNIN_COOKIE_PATH, maxAge: 0 });
        return res;
    };

    if (!result) return NextResponse.json({ status: "pending" }, { headers: NO_STORE });
    switch (result.status) {
        case "pending":
            return NextResponse.json({ status: "pending" }, { headers: NO_STORE });
        case "none":
            return NextResponse.json({ status: "none" }, { headers: NO_STORE });
        case "cancelled":
        case "expired":
            audit(result.status);
            return clear(NextResponse.json({ status: result.status }, { headers: NO_STORE }));
        case "refused":
            audit(`refused_${result.reason}`);
            return clear(NextResponse.json({ status: "error", code: result.reason }, { headers: NO_STORE }));
        case "approved": {
            const member = (membership as Extract<GuildMembership, { status: "member" }> | null)?.member;
            const nick = member?.nick ?? undefined;
            const username = member?.user?.username;
            const issued = await issueLoginSession({
                discordId: result.discordId,
                username,
                nick,
                authMethod: "telegram",
                expiresAt: Date.now() + cfg.sessionDays * 24 * 60 * 60 * 1000,
            });
            const href = loggedInLanding(
                { discordId: result.discordId, memberId: issued.memberId ?? null, nick, username },
                { returnTo: result.returnTo, wizardHome: marketingHomeAtRoot() ? "/start" : "/" },
            );
            audit("signed_in", result.discordId);
            const res = NextResponse.json({ status: "approved", href }, { headers: NO_STORE });
            setSessionCookies(res, issued.token, req);
            return clear(res);
        }
    }
}
