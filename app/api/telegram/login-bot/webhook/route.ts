// app/api/telegram/login-bot/webhook/route.ts
//
// Webhook for OUR login bot only (never the shared rsv.pizza bot). Two-sided "Link with the Telegram app":
//   1. private `/start <code>`  -> the sender claims the member's code; the bot asks "Link this Telegram to
//      the PizzaDAO member <name>?" with a "Yes, link" button (callback_data is an opaque ref, not the code),
//   2. the claimant taps Yes     -> the code is marked confirmed on the Telegram side,
//   3. the member confirms on the website (POST /api/telegram/link/pending), which does the actual link.
// Nothing is linked from here, so a deep link sent to someone else cannot link their account by itself.
//
// Auth: X-Telegram-Bot-Api-Secret-Token must equal TELEGRAM_LOGIN_WEBHOOK_SECRET (unset -> 503, wrong -> 401).
// Everything after auth answers 200 so Telegram does not retry. Only production acts: previews share the
// production database. Forwarded messages are ignored. Message text and ids are never logged.

import { createHash, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { fetchMemberById, fetchMemberIdByDiscordId } from "@/app/lib/sheets/member-repository";
import { telegramConfig } from "@/app/lib/telegram-auth";
import { claimLinkCode, confirmByTelegram } from "@/app/lib/telegram/link-code";
import { loginBotCall, loginBotSend } from "@/app/lib/telegram/login-bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OK = () => NextResponse.json({ ok: true });

const EXPIRED = "This link expired. Start again from your profile.";
const WENT_WRONG = "Something went wrong. Start again from your profile.";

function secretMatches(given: string | null, expected: string): boolean {
    if (!given) return false;
    const a = createHash("sha256").update(given).digest();
    const b = createHash("sha256").update(expected).digest();
    return timingSafeEqual(a, b);
}

interface TgFrom {
    id?: unknown;
    is_bot?: unknown;
    username?: unknown;
    first_name?: unknown;
    last_name?: unknown;
}
interface TgMessage {
    message_id?: unknown;
    text?: unknown;
    chat?: { id?: unknown; type?: unknown };
    from?: TgFrom;
    forward_origin?: unknown;
    forward_date?: unknown;
}
interface TgUpdate {
    message?: TgMessage;
    callback_query?: { id?: unknown; from?: TgFrom; data?: unknown; message?: TgMessage };
}

/** Mafia Name, else a masked Discord handle (ab…yz). Never the sheet's real "Name". Null when neither is known. */
async function publicLabel(discordId: string): Promise<string | null> {
    const memberId = await fetchMemberIdByDiscordId(discordId);
    const row = memberId ? await fetchMemberById(memberId) : null;
    if (!row) return null;
    const mafia = String(row["Mafia Name"] ?? "").trim();
    if (mafia) return mafia;
    const handle = String(row["Discord Username"] ?? row["Discord Handle"] ?? row["Username"] ?? "").trim();
    return handle.length >= 5 ? `${handle.slice(0, 2)}…${handle.slice(-2)}` : null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, 256) : null);
const userId = (from: TgFrom | undefined): string | null => {
    if (!from || from.is_bot === true) return null;
    const raw = typeof from.id === "number" || typeof from.id === "string" ? String(from.id) : "";
    return /^\d{1,20}$/.test(raw) ? raw : null;
};

async function onStart(botToken: string, msg: TgMessage) {
    if (msg.forward_origin || msg.forward_date) return;
    if (msg.chat?.type !== "private" || typeof msg.chat.id !== "number") return;
    const chatId = msg.chat.id;
    const text = typeof msg.text === "string" ? msg.text : "";
    const m = /^\/start(?:@\w+)?(?:\s+(\S+))?\s*$/.exec(text);
    if (!m) return;
    if (!m[1]) {
        await loginBotSend(botToken, chatId, "To link Telegram, use the link on your PizzaDAO profile page.");
        return;
    }
    const fromId = userId(msg.from);
    if (!fromId || String(chatId) !== fromId) return;

    const claim = await claimLinkCode(m[1], {
        id: fromId,
        username: str(msg.from?.username),
        firstName: str(msg.from?.first_name),
        lastName: str(msg.from?.last_name),
    });
    if (!claim) {
        await loginBotSend(botToken, chatId, EXPIRED);
        return;
    }
    const name = await publicLabel(claim.discordId).catch(() => null);
    if (!name) {
        await loginBotSend(botToken, chatId, "This link can't be used. Start again from your profile.");
        return;
    }
    await loginBotSend(
        botToken,
        chatId,
        `Link this Telegram to the PizzaDAO member ${name}? Only tap if you started this from your own profile.`,
        { reply_markup: { inline_keyboard: [[{ text: "Yes, link", callback_data: `ok:${claim.ref}` }]] } },
    );
}

async function onCallback(botToken: string, cq: NonNullable<TgUpdate["callback_query"]>) {
    const queryId = typeof cq.id === "string" ? cq.id : null;
    const fromId = userId(cq.from);
    const data = typeof cq.data === "string" ? cq.data : "";
    const msg = cq.message;
    // Answer first, whatever happens next, so the button never keeps spinning.
    if (queryId) await loginBotCall(botToken, "answerCallbackQuery", { callback_query_id: queryId });
    if (!queryId || !fromId || !data.startsWith("ok:") || msg?.chat?.type !== "private") return;

    const ok = await confirmByTelegram(data.slice(3), fromId);
    if (typeof msg.chat.id === "number" && typeof msg.message_id === "number") {
        await loginBotCall(botToken, "editMessageText", {
            chat_id: msg.chat.id,
            message_id: msg.message_id,
            text: ok ? "Waiting for you to confirm on the website." : EXPIRED,
        });
    }
}

export async function POST(req: Request) {
    const secret = process.env.TELEGRAM_LOGIN_WEBHOOK_SECRET?.trim();
    if (!secret) return NextResponse.json({ error: "Not configured" }, { status: 503 });
    if (!secretMatches(req.headers.get("x-telegram-bot-api-secret-token"), secret)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Previews share the production database: only production acts. Missing login-bot env is a no-op too.
    if (process.env.VERCEL_ENV !== "production") return OK();
    const cfg = telegramConfig();
    if (!cfg) return OK();

    const update = (await req.json().catch(() => null)) as TgUpdate | null;
    try {
        if (update?.callback_query) await onCallback(cfg.botToken, update.callback_query);
        else if (update?.message) await onStart(cfg.botToken, update.message);
    } catch {
        // Never let Telegram retry in a loop. Tell the person, once, if we know where they are.
        const chat = update?.message?.chat ?? update?.callback_query?.message?.chat;
        if (chat?.type === "private" && typeof chat.id === "number") await loginBotSend(cfg.botToken, chat.id, WENT_WRONG);
    }
    return OK();
}
