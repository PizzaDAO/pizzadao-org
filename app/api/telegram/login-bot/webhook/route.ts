// app/api/telegram/login-bot/webhook/route.ts
//
// Webhook for OUR login bot only (never the shared rsv.pizza bot). "Link with the Telegram app":
//   1. private `/start <code>`  -> the sender claims the member's code; the bot asks "Connect this Telegram to
//      the PizzaDAO member <name>?" with a "Yes, connect" button (callback_data is an opaque ref, not the code),
//   2. the claimant taps Yes     -> the code is spent atomically and the account is linked right here; the bot
//      edits its message to say so. Only the claiming Telegram user can complete it.
// A member who already has a different Telegram is never overwritten, and a Telegram linked to another member
// is refused. The profile card polls and flips to connected.
//
// "Sign in with Telegram" (plans/calzone-93434.md) shares this webhook: `/start si_<code>` from a LINKED account
// is shown three numbers; tapping the one the browser shows approves the sign-in, any other cancels it. It never
// creates or changes a link, and the bot never sends a login link.
//
// Auth: X-Telegram-Bot-Api-Secret-Token must equal TELEGRAM_LOGIN_WEBHOOK_SECRET (unset -> 503, wrong -> 401).
// Everything after auth answers 200 so Telegram does not retry. Only production acts: previews share the
// production database. Forwarded messages are ignored. Message text and ids are never logged.

import { createHash, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { fetchMemberById, fetchMemberIdByDiscordId } from "@/app/lib/sheets/member-repository";
import { telegramConfig } from "@/app/lib/telegram-auth";
import { linkTelegramAccount } from "@/app/lib/telegram/link-account";
import { claimLinkCode, spendByTelegram } from "@/app/lib/telegram/link-code";
import { loginBotCall, loginBotSend } from "@/app/lib/telegram/login-bot";
import { prisma } from "@/app/lib/db";
import { answerSignin, claimSignin, numberChoices, SIGNIN_START_PREFIX } from "@/app/lib/telegram/signin-code";
import { signinAllowed, signinConfig } from "@/app/lib/telegram/signin-settings";

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

/** The member's public name (the sheet's "Name" column, as shown on their profile), else their member number. */
async function publicLabel(discordId: string): Promise<string | null> {
    const memberId = await fetchMemberIdByDiscordId(discordId);
    const row = memberId ? await fetchMemberById(memberId) : null;
    if (!row) return null;
    return String(row["Name"] || row["Mafia Name"] || "").trim() || `#${memberId}`;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, 256) : null);
const userId = (from: TgFrom | undefined): string | null => {
    if (!from || from.is_bot === true) return null;
    const raw = typeof from.id === "number" || typeof from.id === "string" ? String(from.id) : "";
    return /^\d{1,20}$/.test(raw) ? raw : null;
};

const SIGNIN_OFF = "Sign in with Telegram isn't available right now. Log in with Discord instead.";
const SIGNIN_NOT_LINKED = "This Telegram isn't connected to a PizzaDAO member. Log in with Discord once, then connect Telegram on your profile page.";
const SIGNIN_EXPIRED = "This sign-in expired. Start again from the website.";

/** `/start si_<code>`: a linked account claims the sign-in and gets the three numbers. */
async function onSigninStart(botToken: string, chatId: number, fromId: string, code: string) {
    const cfg = await signinConfig();
    if (!cfg.enabled) {
        await loginBotSend(botToken, chatId, SIGNIN_OFF);
        return;
    }
    // Only a linked account can claim, and a refusal leaves the code alone so a stranger cannot burn it.
    const account = await prisma.telegramAccount.findUnique({ where: { telegramId: fromId }, select: { discordId: true } });
    if (!account) {
        await loginBotSend(botToken, chatId, SIGNIN_NOT_LINKED);
        return;
    }
    if (!signinAllowed(cfg, account.discordId)) {
        await loginBotSend(botToken, chatId, SIGNIN_OFF);
        return;
    }
    const claim = await claimSignin(code, fromId, account.discordId);
    if (claim.status === "limited") {
        await loginBotSend(botToken, chatId, "Too many attempts. Try again later.");
        return;
    }
    if (claim.status !== "claimed") {
        await loginBotSend(botToken, chatId, SIGNIN_EXPIRED);
        return;
    }
    const name = await publicLabel(account.discordId).catch(() => null);
    await loginBotSend(
        botToken,
        chatId,
        `Sign in to PizzaDAO${name ? ` as ${name}` : ""}? Tap the number your browser shows. Only continue if you just pressed Sign in with Telegram on the PizzaDAO website.`,
        {
            reply_markup: {
                inline_keyboard: [numberChoices(claim.matchNumber).map((n) => ({ text: String(n), callback_data: `si:${claim.ref}:${n}` }))],
            },
        },
    );
}

async function onSigninTap(botToken: string, fromId: string, data: string, msg: TgMessage) {
    const m = /^si:([A-Za-z0-9_-]{22}):(\d{2})$/.exec(data);
    if (!m) return;
    const outcome = await answerSignin(m[1], fromId, Number(m[2]));
    if (outcome === "ignore") return;
    const text =
        outcome === "approved"
            ? "Signed in. Go back to your browser."
            : outcome === "cancelled"
              ? "Cancelled. Start again from the website."
              : SIGNIN_EXPIRED;
    if (typeof msg.chat?.id === "number" && typeof msg.message_id === "number") {
        await loginBotCall(botToken, "editMessageText", { chat_id: msg.chat.id, message_id: msg.message_id, text });
    }
}

async function onStart(botToken: string, msg: TgMessage) {
    if (msg.forward_origin || msg.forward_date) return;
    if (msg.chat?.type !== "private" || typeof msg.chat.id !== "number") return;
    const chatId = msg.chat.id;
    const text = typeof msg.text === "string" ? msg.text : "";
    const m = /^\/start(?:@\w+)?(?:\s+(\S+))?\s*$/.exec(text);
    if (!m) return;
    if (!m[1]) {
        await loginBotSend(botToken, chatId, "To connect Telegram, use the link on your PizzaDAO profile page.");
        return;
    }
    const fromId = userId(msg.from);
    if (!fromId || String(chatId) !== fromId) return;

    if (m[1].startsWith(SIGNIN_START_PREFIX)) {
        await onSigninStart(botToken, chatId, fromId, m[1].slice(SIGNIN_START_PREFIX.length));
        return;
    }

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
        `Connect this Telegram to the PizzaDAO member ${name}? Only tap if you started this from your own profile.`,
        { reply_markup: { inline_keyboard: [[{ text: "Yes, connect", callback_data: `ok:${claim.ref}` }]] } },
    );
}

async function onCallback(botToken: string, cq: NonNullable<TgUpdate["callback_query"]>) {
    const queryId = typeof cq.id === "string" ? cq.id : null;
    const fromId = userId(cq.from);
    const data = typeof cq.data === "string" ? cq.data : "";
    const msg = cq.message;
    // Answer first, whatever happens next, so the button never keeps spinning.
    if (queryId) await loginBotCall(botToken, "answerCallbackQuery", { callback_query_id: queryId });
    if (!queryId || !fromId || msg?.chat?.type !== "private") return;
    if (data.startsWith("si:")) {
        await onSigninTap(botToken, fromId, data, msg);
        return;
    }
    if (!data.startsWith("ok:")) return;

    // The member lookup runs before the code is spent, so a failure or kill in between can't lose the code.
    const who: { name: string | null } = { name: null };
    const spent = await spendByTelegram(data.slice(3), fromId, Date.now(), async (discordId) => {
        who.name = await publicLabel(discordId);
    });
    // Someone else's tap, or a double tap whose first call already did the work: say nothing.
    if (spent.result === "ignore") return;

    let text = EXPIRED;
    if (spent.result === "spent") {
        const { discordId, claimant } = spent.link;
        const outcome = await linkTelegramAccount(
            discordId,
            { ...claimant, photoUrl: null, authDate: new Date() },
            { replaceExisting: false },
        );
        if (outcome === "linked") {
            text = `Connected${who.name ? ` to the PizzaDAO member ${who.name}` : ""}. If this wasn't you, disconnect it on the PizzaDAO profile page.`;
        } else if (outcome === "member_linked") {
            text = "This member already has a Telegram connected. Disconnect it on the PizzaDAO profile page, then start again.";
        } else {
            text = "This Telegram account is already connected to another PizzaDAO member.";
        }
    }
    if (typeof msg.chat.id === "number" && typeof msg.message_id === "number") {
        await loginBotCall(botToken, "editMessageText", { chat_id: msg.chat.id, message_id: msg.message_id, text });
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
