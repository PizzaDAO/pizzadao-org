// app/lib/telegram/link-code.ts
//
// Codes for "Link with the Telegram app". The code travels in t.me/<login bot>?start=<code>
// (Telegram allows 64 chars of [A-Za-z0-9_-]); 32 random bytes in base64url is 43. Only the sha256 is stored.
//
// Flow, entirely in the bot (no website confirmation):
//   1. the first Telegram user to press Start CLAIMS the code (claimLinkCode),
//   2. the bot asks "Connect this Telegram to member X?"; that same user taps "Yes, connect" (opaque ref),
//   3. the tap SPENDS the code atomically (spendByTelegram) and the webhook links the account.
// The code expires 10 minutes after it was made and works once. The tgConfirmedAt column is no longer used.

import { createHash, randomBytes } from "crypto";
import { prisma } from "@/app/lib/db";

export const LINK_CODE_TTL_MS = 10 * 60 * 1000;
const CODE_RE = /^[A-Za-z0-9_-]{43}$/;
const REF_RE = /^[A-Za-z0-9_-]{22}$/;

export interface ClaimantInfo {
    id: string;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
}

export function hashLinkCode(code: string): string {
    return createHash("sha256").update(code).digest("hex");
}

export function isLinkCodeShape(code: string): boolean {
    return CODE_RE.test(code);
}

export function isRefShape(ref: string): boolean {
    return REF_RE.test(ref);
}

/** New code for a member; their earlier unused codes stop working. */
export async function createLinkCode(discordId: string, now = Date.now()): Promise<string> {
    const code = randomBytes(32).toString("base64url");
    await prisma.telegramLinkCode.deleteMany({
        where: { OR: [{ discordId, usedAt: null }, { expiresAt: { lt: new Date(now - 24 * 60 * 60 * 1000) } }] },
    });
    await prisma.telegramLinkCode.create({
        data: { codeHash: hashLinkCode(code), discordId, expiresAt: new Date(now + LINK_CODE_TTL_MS) },
    });
    return code;
}

/**
 * First presser claims the code (conditional update, so two people cannot both claim it). Pressing Start
 * again as the same user returns the same ref. Returns the member and the button ref, or null.
 */
export async function claimLinkCode(code: string, tg: ClaimantInfo, now = Date.now()): Promise<{ discordId: string; ref: string } | null> {
    if (!isLinkCodeShape(code)) return null;
    const codeHash = hashLinkCode(code);
    const row = await prisma.telegramLinkCode.findUnique({
        where: { codeHash },
        select: { discordId: true, tgId: true, ref: true, usedAt: true, expiresAt: true },
    });
    if (!row || row.usedAt || row.expiresAt.getTime() <= now) return null;
    if (row.tgId) return row.tgId === tg.id && row.ref ? { discordId: row.discordId, ref: row.ref } : null;
    const ref = randomBytes(16).toString("base64url");
    const res = await prisma.telegramLinkCode.updateMany({
        where: { codeHash, usedAt: null, tgId: null, expiresAt: { gt: new Date(now) } },
        data: { tgId: tg.id, tgUsername: tg.username, tgFirstName: tg.firstName, tgLastName: tg.lastName, ref, claimedAt: new Date(now) },
    });
    return res.count === 1 ? { discordId: row.discordId, ref } : null;
}

export interface SpentLink {
    discordId: string;
    claimant: ClaimantInfo;
}

/**
 * The claimant tapped "Yes, connect". Spends the code atomically (conditional update), so a double tap or a
 * retry links at most once, and only the claiming Telegram user can do it.
 *   "spent"   -> this call owns the code; link now,
 *   "expired" -> the code ran out (or never existed for this user's ref),
 *   "ignore"  -> someone else's tap, or the code was already spent: do nothing.
 */
export async function spendByTelegram(
    ref: string,
    fromId: string,
    now = Date.now(),
): Promise<{ result: "spent"; link: SpentLink } | { result: "expired" | "ignore" }> {
    if (!isRefShape(ref)) return { result: "ignore" };
    const row = await prisma.telegramLinkCode.findUnique({
        where: { ref },
        select: { codeHash: true, discordId: true, tgId: true, tgUsername: true, tgFirstName: true, tgLastName: true, usedAt: true, expiresAt: true },
    });
    if (!row || !row.tgId || row.tgId !== fromId || row.usedAt) return { result: "ignore" };
    if (row.expiresAt.getTime() <= now) return { result: "expired" };
    const res = await prisma.telegramLinkCode.updateMany({
        where: { codeHash: row.codeHash, ref, tgId: fromId, usedAt: null, expiresAt: { gt: new Date(now) } },
        data: { usedAt: new Date(now) },
    });
    if (res.count !== 1) return { result: "ignore" };
    return {
        result: "spent",
        link: {
            discordId: row.discordId,
            claimant: { id: row.tgId, username: row.tgUsername, firstName: row.tgFirstName, lastName: row.tgLastName },
        },
    };
}

/** Discard the member's unused codes (Stop waiting). */
export async function cancelPending(discordId: string): Promise<void> {
    await prisma.telegramLinkCode.deleteMany({ where: { discordId, usedAt: null } });
}
