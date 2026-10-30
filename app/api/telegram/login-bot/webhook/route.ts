// app/api/telegram/login-bot/webhook/route.ts
//
// Webhook for OUR login bot only (never the shared rsv.pizza bot). It handles one thing: a private
// message `/start <code>` that finishes "Link with the Telegram app". The code was issued to a logged-in
// member by POST /api/telegram/link/start; the sender of the message is then linked to that member.
//
// Auth: X-Telegram-Bot-Api-Secret-Token must equal TELEGRAM_LOGIN_WEBHOOK_SECRET (unset -> 503, wrong -> 401).
// Handled and ignored updates answer 200 so Telegram does not retry. Only production acts: previews share
// the production database. Message text and ids are never logged.

import { createHash, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { telegramConfig } from "@/app/lib/telegram-auth";
import { linkTelegramAccount } from "@/app/lib/telegram/link-account";
import { consumeLinkCode } from "@/app/lib/telegram/link-code";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OK = () => NextResponse.json({ ok: true });

function secretMatches(given: string | null, expected: string): boolean {
    if (!given) return false;
    const a = createHash("sha256").update(given).digest();
    const b = createHash("sha256").update(expected).digest();
    return timingSafeEqual(a, b);
}

async function reply(botToken: string, chatId: number, text: string): Promise<void> {
    try {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: chatId, text }),
            signal: AbortSignal.timeout(8000),
        });
    } catch {
        // Best effort; the profile page polls and shows the result either way.
    }
}

interface TgMessage {
    text?: unknown;
    chat?: { id?: unknown; type?: unknown };
    from?: { id?: unknown; is_bot?: unknown; username?: unknown; first_name?: unknown; last_name?: unknown };
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, 256) : null);

export async function POST(req: Request) {
    const secret = process.env.TELEGRAM_LOGIN_WEBHOOK_SECRET?.trim();
    if (!secret) return NextResponse.json({ error: "Not configured" }, { status: 503 });
    if (!secretMatches(req.headers.get("x-telegram-bot-api-secret-token"), secret)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Previews share the production database: only production acts.
    if (process.env.VERCEL_ENV !== "production") return OK();
    const cfg = telegramConfig();
    if (!cfg) return NextResponse.json({ error: "Not configured" }, { status: 503 });

    const update = (await req.json().catch(() => null)) as { message?: TgMessage } | null;
    const msg = update?.message;
    if (!msg || msg.chat?.type !== "private" || typeof msg.chat.id !== "number") return OK();
    const chatId = msg.chat.id;
    const text = typeof msg.text === "string" ? msg.text : "";

    const m = /^\/start(?:@\w+)?(?:\s+(\S+))?\s*$/.exec(text);
    if (!m) return OK();
    if (!m[1]) {
        await reply(cfg.botToken, chatId, "To link Telegram, use the link on your PizzaDAO profile page.");
        return OK();
    }

    const from = msg.from;
    const fromId = typeof from?.id === "number" || typeof from?.id === "string" ? String(from.id) : "";
    if (!from || from.is_bot === true || !/^\d{1,20}$/.test(fromId) || String(chatId) !== fromId) return OK();

    const discordId = await consumeLinkCode(m[1]);
    if (!discordId) {
        await reply(cfg.botToken, chatId, "This link expired. Start again from your profile.");
        return OK();
    }

    const outcome = await linkTelegramAccount(discordId, {
        id: fromId,
        username: str(from.username),
        firstName: str(from.first_name),
        lastName: str(from.last_name),
        photoUrl: null,
        authDate: new Date(),
    });
    await reply(
        cfg.botToken,
        chatId,
        outcome === "linked"
            ? "Linked to your PizzaDAO account. If this wasn't you, unlink it on your profile."
            : "This Telegram account is already linked to another member.",
    );
    return OK();
}
