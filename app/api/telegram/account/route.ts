// app/api/telegram/account/route.ts
//
// Link / unlink the logged-in member's Telegram account (calzone-93434).
//
//   GET    -> { enabled, botUsername, connected, username, firstName, lastName, photoUrl, telegramDm: { state, botUsername } }
//   POST   -> body = Telegram Login Widget `user` object; HMAC-verified, then stored
//   DELETE -> unlink
//
// All methods require a Discord session. When TELEGRAM_LOGIN_BOT_TOKEN or
// NEXT_PUBLIC_TELEGRAM_LOGIN_BOT_USERNAME is unset, GET reports enabled:false (the UI
// hides the button) and POST returns 503. The login bot verifies the widget and answers the /start link (see login-bot/webhook).

import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/db";
import { requireSession } from "@/app/lib/auth-guards";
import { telegramConfig, verifyTelegramAuth } from "@/app/lib/telegram-auth";
import { linkTelegramAccount } from "@/app/lib/telegram/link-account";
import { loadReach } from "@/app/lib/telegram/reach";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET() {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;

    const cfg = telegramConfig();
    if (!cfg) {
        return NextResponse.json({ enabled: false, connected: false }, { headers: NO_STORE });
    }

    const account = await prisma.telegramAccount.findUnique({
        where: { discordId: auth.session.discordId },
        select: { telegramId: true, username: true, firstName: true, lastName: true, photoUrl: true },
    });
    // Whether the shared sender bot can DM this member (the Telegram id itself is never returned).
    const reach = account ? await loadReach(account.telegramId).catch(() => null) : null;
    const { telegramId: _telegramId, ...shown } = account ?? ({} as { telegramId?: string });
    void _telegramId;

    return NextResponse.json(
        {
            enabled: true,
            botUsername: cfg.botUsername,
            connected: Boolean(account),
            telegramDm: {
                state: (reach?.state ?? "UNKNOWN").toLowerCase(),
                botUsername: process.env.NEXT_PUBLIC_TELEGRAM_SENDER_BOT_USERNAME?.trim() || null,
            },
            ...shown,
        },
        { headers: NO_STORE },
    );
}

export async function POST(req: Request) {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;
    const { discordId } = auth.session;

    const cfg = telegramConfig();
    if (!cfg) {
        return NextResponse.json({ error: "Telegram linking is not configured" }, { status: 503 });
    }

    const payload = await req.json().catch(() => null);
    const result = verifyTelegramAuth(payload, cfg.botToken);
    if (!result.ok) {
        return NextResponse.json({ error: result.reason }, { status: 400 });
    }
    const tg = result.user;

    const outcome = await linkTelegramAccount(discordId, tg);
    if (outcome === "conflict") {
        return NextResponse.json(
            { error: "This Telegram account is already linked to another member" },
            { status: 409 },
        );
    }

    return NextResponse.json({
        ok: true,
        connected: true,
        username: tg.username,
        firstName: tg.firstName,
        lastName: tg.lastName,
        photoUrl: tg.photoUrl,
    });
}

export async function DELETE() {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;

    await prisma.telegramAccount.deleteMany({
        where: { discordId: auth.session.discordId },
    });
    return NextResponse.json({ ok: true, connected: false });
}
