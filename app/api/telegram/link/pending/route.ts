// app/api/telegram/link/pending/route.ts
//
// The website half of "Link with the Telegram app". After a Telegram user claimed the member's code and
// tapped "Yes, link" in the bot, the profile shows who wants to link; only this member's POST links it.
//
//   GET  -> { pending: { username, name } | null }   (the Telegram id is never returned)
//   POST { action: 'confirm' | 'cancel' }

import { NextResponse } from "next/server";
import { rejectUnsafeWrite } from "@/app/lib/admin-guard";
import { requireSession } from "@/app/lib/auth-guards";
import { telegramConfig } from "@/app/lib/telegram-auth";
import { linkTelegramAccount } from "@/app/lib/telegram/link-account";
import { cancelPending, getPendingLink, markPendingUsed } from "@/app/lib/telegram/link-code";
import { loginBotSend } from "@/app/lib/telegram/login-bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET() {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;
    const p = await getPendingLink(auth.session.discordId);
    const name = p ? [p.claimant.firstName, p.claimant.lastName].filter(Boolean).join(" ") || null : null;
    return NextResponse.json({ pending: p ? { username: p.claimant.username, name } : null }, { headers: NO_STORE });
}

export async function POST(req: Request) {
    const unsafe = rejectUnsafeWrite(req);
    if (unsafe) return unsafe;
    const auth = await requireSession();
    if (!auth.ok) return auth.response;
    const { discordId } = auth.session;

    const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
    if (body?.action === "cancel") {
        await cancelPending(discordId);
        return NextResponse.json({ ok: true }, { headers: NO_STORE });
    }
    if (body?.action !== "confirm") {
        return NextResponse.json({ error: "Unknown action" }, { status: 400, headers: NO_STORE });
    }

    const p = await getPendingLink(discordId);
    if (!p) return NextResponse.json({ error: "Nothing to confirm. Start again.", code: "nothing_pending" }, { status: 404, headers: NO_STORE });

    const outcome = await linkTelegramAccount(discordId, {
        id: p.claimant.id,
        username: p.claimant.username,
        firstName: p.claimant.firstName,
        lastName: p.claimant.lastName,
        photoUrl: null,
        authDate: new Date(),
    });
    if (outcome === "conflict") {
        await cancelPending(discordId);
        return NextResponse.json(
            { error: "This Telegram account is already linked to another member", code: "already_linked" },
            { status: 409, headers: NO_STORE },
        );
    }
    await markPendingUsed(p.codeHash);

    const cfg = telegramConfig();
    if (cfg) {
        await loginBotSend(cfg.botToken, p.claimant.id, "Linked to your PizzaDAO account. If this wasn't you, unlink it on your profile.");
    }
    return NextResponse.json({ ok: true, connected: true }, { headers: NO_STORE });
}
