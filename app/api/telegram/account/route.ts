// app/api/telegram/account/route.ts
//
// Link / unlink the logged-in member's Telegram account (calzone-93434).
//
//   GET    -> { enabled, botUsername, connected, username, firstName, lastName, photoUrl }
//   POST   -> body = Telegram Login Widget `user` object; HMAC-verified, then stored
//   DELETE -> unlink
//
// All methods require a Discord session. When TELEGRAM_BOT_TOKEN or
// NEXT_PUBLIC_TELEGRAM_BOT_USERNAME is unset, GET reports enabled:false (the UI
// hides the button) and POST returns 503.

import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/db";
import { requireSession } from "@/app/lib/auth-guards";
import { telegramConfig, verifyTelegramAuth } from "@/app/lib/telegram-auth";
import { fetchMemberIdByDiscordId } from "@/app/lib/sheets/member-repository";

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
        select: { username: true, firstName: true, lastName: true, photoUrl: true },
    });

    return NextResponse.json(
        {
            enabled: true,
            botUsername: cfg.botUsername,
            connected: Boolean(account),
            ...(account ?? {}),
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

    // One Telegram account per member: refuse if it's already linked elsewhere.
    const existing = await prisma.telegramAccount.findUnique({
        where: { telegramId: tg.id },
        select: { discordId: true },
    });
    if (existing && existing.discordId !== discordId) {
        return NextResponse.json(
            { error: "This Telegram account is already linked to another member" },
            { status: 409 },
        );
    }

    let memberId: string | null = null;
    try {
        memberId = await fetchMemberIdByDiscordId(discordId);
    } catch {
        // Best-effort; the row is keyed by discordId.
    }

    const fields = {
        telegramId: tg.id,
        username: tg.username,
        firstName: tg.firstName,
        lastName: tg.lastName,
        photoUrl: tg.photoUrl,
        authDate: tg.authDate,
        ...(memberId ? { memberId } : {}),
    };

    try {
        await prisma.telegramAccount.upsert({
            where: { discordId },
            create: { discordId, ...fields },
            update: fields,
        });
    } catch (e: unknown) {
        // Unique race on telegramId between the check above and the write.
        if ((e as { code?: string })?.code === "P2002") {
            return NextResponse.json(
                { error: "This Telegram account is already linked to another member" },
                { status: 409 },
            );
        }
        throw e;
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
