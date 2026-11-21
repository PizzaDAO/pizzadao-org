// app/lib/telegram/signin-code.ts
//
// "Sign in with Telegram" (plans/calzone-93434.md). The browser on /login asks for a request; the code travels
// in t.me/<login bot>?start=si_<code> (43 base64url chars after the prefix, under Telegram's 64 limit). Only
// hashes are stored: the code's, and the hash of a private secret kept in an httpOnly cookie in the browser
// that asked. So a leaked t.me link alone can never be turned into a session.
//
//   1. the first Telegram user to press Start CLAIMS the request (claimSignin), if their account is linked,
//   2. the bot shows 3 numbers; tapping the one the browser shows APPROVES (answerSignin), any other CANCELS,
//   3. the browser's poll SPENDS the approval once (consumeSignin) and gets the session.
// Every step is a conditional update, so races and replays do at most one thing. This file never touches a
// TelegramAccount: sign-in only reads the link.

import { createHash, randomBytes, randomInt } from "crypto";
import { prisma } from "@/app/lib/db";
import { loginReturnPath } from "@/app/lib/login-return";

export const SIGNIN_START_PREFIX = "si_";
export const SIGNIN_DEFAULT_TTL_MINUTES = 5;
/** Sign-in requests one Telegram account may claim per hour. */
export const SIGNIN_MAX_CLAIMS_PER_HOUR = 3;
export const SIGNIN_COOKIE = "pd_tg_signin";
/** The cookie is only sent to the sign-in routes. */
export const SIGNIN_COOKIE_PATH = "/api/auth/telegram";

const CODE_RE = /^[A-Za-z0-9_-]{43}$/;
const REF_RE = /^[A-Za-z0-9_-]{22}$/;
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
export const hashSigninValue = sha;
export const isSigninCodeShape = (code: string) => CODE_RE.test(code);
export const isSigninRefShape = (ref: string) => REF_RE.test(ref);

/** What the browser keeps in its cookie: `<code>.<secret>`. Null when malformed. */
export function parseSigninCookie(value: string | undefined | null): { code: string; secret: string } | null {
    if (!value || value.length > 120) return null;
    const [code, secret, extra] = value.split(".");
    if (extra !== undefined || !code || !secret || !CODE_RE.test(code) || !SECRET_RE.test(secret)) return null;
    return { code, secret };
}

export interface CreatedSignin {
    code: string;
    cookieValue: string;
    matchNumber: number;
    expiresAt: Date;
}

/** Make a request for this browser. `returnTo` is cleaned here, and again when it is used. */
export async function createSigninRequest(opts: { returnTo?: unknown; ttlMinutes?: number; now?: number }): Promise<CreatedSignin> {
    const now = opts.now ?? Date.now();
    const ttl = Math.min(10, Math.max(2, Math.round(opts.ttlMinutes ?? SIGNIN_DEFAULT_TTL_MINUTES)));
    const code = randomBytes(32).toString("base64url");
    const secret = randomBytes(32).toString("base64url");
    const matchNumber = randomInt(10, 100);
    const expiresAt = new Date(now + ttl * 60 * 1000);
    // Lazy pruning, like the link codes.
    await prisma.telegramSignInRequest.deleteMany({ where: { expiresAt: { lt: new Date(now - DAY_MS) } } });
    await prisma.telegramSignInRequest.create({
        data: {
            codeHash: sha(code),
            browserHash: sha(secret),
            matchNumber,
            returnTo: loginReturnPath(opts.returnTo) ?? null,
            expiresAt,
        },
    });
    return { code, cookieValue: `${code}.${secret}`, matchNumber, expiresAt };
}

export type ClaimResult =
    | { status: "claimed"; ref: string; matchNumber: number }
    | { status: "expired" }
    | { status: "limited" };

/**
 * The first presser (a linked account, checked by the caller) claims the request. Pressing Start again as the
 * same user returns the same ref. A different user cannot take a claimed request.
 */
export async function claimSignin(code: string, tgId: string, discordId: string, now = Date.now()): Promise<ClaimResult> {
    if (!isSigninCodeShape(code)) return { status: "expired" };
    const codeHash = sha(code);
    const row = await prisma.telegramSignInRequest.findUnique({
        where: { codeHash },
        select: { tgId: true, ref: true, matchNumber: true, approvedAt: true, consumedAt: true, cancelledAt: true, expiresAt: true },
    });
    if (!row || row.consumedAt || row.cancelledAt || row.approvedAt || row.expiresAt.getTime() <= now) return { status: "expired" };
    if (row.tgId) return row.tgId === tgId && row.ref ? { status: "claimed", ref: row.ref, matchNumber: row.matchNumber } : { status: "expired" };

    // Phishing guard: one Telegram account can only be asked to sign in so often.
    const recent = await prisma.telegramSignInRequest.count({ where: { tgId, createdAt: { gt: new Date(now - HOUR_MS) } } });
    if (recent >= SIGNIN_MAX_CLAIMS_PER_HOUR) return { status: "limited" };

    const ref = randomBytes(16).toString("base64url");
    const res = await prisma.telegramSignInRequest.updateMany({
        where: { codeHash, tgId: null, cancelledAt: null, consumedAt: null, expiresAt: { gt: new Date(now) } },
        data: { tgId, discordId, ref, claimedAt: new Date(now) },
    });
    return res.count === 1 ? { status: "claimed", ref, matchNumber: row.matchNumber } : { status: "expired" };
}

/** The three numbers shown in the bot: the real one and two decoys, in random order. */
export function numberChoices(matchNumber: number): number[] {
    const set = new Set<number>([matchNumber]);
    while (set.size < 3) set.add(randomInt(10, 100));
    const list = [...set];
    for (let i = list.length - 1; i > 0; i--) {
        const j = randomInt(0, i + 1);
        [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
}

/**
 *   "approved"  -> the right number: this call approved it,
 *   "cancelled" -> a wrong number: this call cancelled it,
 *   "expired"   -> it ran out, was cancelled, or is gone,
 *   "ignore"    -> someone else's tap, or already answered: do nothing.
 */
export async function answerSignin(
    ref: string,
    fromId: string,
    picked: number,
    now = Date.now(),
): Promise<"approved" | "cancelled" | "expired" | "ignore"> {
    if (!isSigninRefShape(ref)) return "ignore";
    const row = await prisma.telegramSignInRequest.findUnique({
        where: { ref },
        select: { codeHash: true, tgId: true, matchNumber: true, approvedAt: true, consumedAt: true, cancelledAt: true, expiresAt: true },
    });
    if (!row) return "expired";
    if (!row.tgId || row.tgId !== fromId) return "ignore";
    if (row.approvedAt || row.consumedAt || row.cancelledAt) return "ignore";
    if (row.expiresAt.getTime() <= now) return "expired";
    const open = { codeHash: row.codeHash, tgId: fromId, approvedAt: null, consumedAt: null, cancelledAt: null, expiresAt: { gt: new Date(now) } };
    if (picked !== row.matchNumber) {
        const res = await prisma.telegramSignInRequest.updateMany({ where: open, data: { cancelledAt: new Date(now) } });
        return res.count === 1 ? "cancelled" : "ignore";
    }
    const res = await prisma.telegramSignInRequest.updateMany({ where: open, data: { approvedAt: new Date(now) } });
    return res.count === 1 ? "approved" : "ignore";
}

export type ConsumeResult =
    | { status: "none" }
    | { status: "pending" }
    | { status: "cancelled" }
    | { status: "expired" }
    | { status: "refused"; reason: string }
    | { status: "approved"; discordId: string; returnTo: string | undefined };

/**
 * The browser's poll. Only the browser holding the cookie secret can ever see an approval, and only once.
 * `precheck` (guild membership, allowlist) runs while the approval is still unspent: null lets it through,
 * "retry" leaves the request for the next poll, and any other string refuses (and ends) the request.
 */
export async function consumeSignin(
    cookieValue: string | undefined | null,
    now = Date.now(),
    precheck?: (discordId: string) => Promise<string | null>,
): Promise<ConsumeResult> {
    const parsed = parseSigninCookie(cookieValue);
    if (!parsed) return { status: "none" };
    const codeHash = sha(parsed.code);
    const row = await prisma.telegramSignInRequest.findUnique({
        where: { codeHash },
        select: { browserHash: true, discordId: true, returnTo: true, approvedAt: true, consumedAt: true, cancelledAt: true, expiresAt: true },
    });
    if (!row || row.browserHash !== sha(parsed.secret) || row.consumedAt) return { status: "none" };
    if (row.cancelledAt) return { status: "cancelled" };
    if (row.expiresAt.getTime() <= now) return { status: "expired" };
    if (!row.approvedAt || !row.discordId) return { status: "pending" };

    if (precheck) {
        const verdict = await precheck(row.discordId);
        if (verdict === "retry") return { status: "pending" };
        if (verdict) {
            await prisma.telegramSignInRequest.updateMany({ where: { codeHash, consumedAt: null }, data: { cancelledAt: new Date(now) } });
            return { status: "refused", reason: verdict };
        }
    }
    const res = await prisma.telegramSignInRequest.updateMany({
        where: { codeHash, browserHash: row.browserHash, approvedAt: { not: null }, consumedAt: null, cancelledAt: null, expiresAt: { gt: new Date(now) } },
        data: { consumedAt: new Date(now) },
    });
    if (res.count !== 1) return { status: "none" };
    return { status: "approved", discordId: row.discordId, returnTo: loginReturnPath(row.returnTo) };
}

/** "Stop waiting": drop this browser's pending request. */
export async function cancelSignin(cookieValue: string | undefined | null): Promise<void> {
    const parsed = parseSigninCookie(cookieValue);
    if (!parsed) return;
    await prisma.telegramSignInRequest.deleteMany({ where: { codeHash: sha(parsed.code), browserHash: sha(parsed.secret), consumedAt: null } });
}
