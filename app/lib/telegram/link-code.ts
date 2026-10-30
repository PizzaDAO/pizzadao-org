// app/lib/telegram/link-code.ts
//
// Codes for "Link with the Telegram app". The code travels in t.me/<login bot>?start=<code>
// (Telegram allows 64 chars of [A-Za-z0-9_-]); 32 random bytes in base64url is 43. Only the sha256 is stored.
//
// Two-sided, so a code forwarded to someone else cannot link their account silently:
//   1. the first Telegram user to press Start CLAIMS the code (claimLinkCode),
//   2. that user taps "Yes, link" in the bot (confirmByTelegram, by an opaque ref),
//   3. the member sees "Telegram X wants to link" on the website and confirms (completePending).
// The whole thing expires 10 minutes after the code was made.

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

/** The claimant tapped "Yes, link" in the bot. Only the claiming Telegram user can do this. */
export async function confirmByTelegram(ref: string, fromId: string, now = Date.now()): Promise<boolean> {
    if (!isRefShape(ref)) return false;
    const res = await prisma.telegramLinkCode.updateMany({
        where: { ref, tgId: fromId, usedAt: null, expiresAt: { gt: new Date(now) } },
        data: { tgConfirmedAt: new Date(now) },
    });
    return res.count === 1;
}

export interface PendingLink {
    codeHash: string;
    claimant: ClaimantInfo;
}

async function findPending(discordId: string, now: number): Promise<PendingLink | null> {
    const row = await prisma.telegramLinkCode.findFirst({
        where: { discordId, usedAt: null, expiresAt: { gt: new Date(now) }, tgConfirmedAt: { not: null }, tgId: { not: null } },
        orderBy: { createdAt: "desc" },
        select: { codeHash: true, tgId: true, tgUsername: true, tgFirstName: true, tgLastName: true },
    });
    if (!row || !row.tgId) return null;
    return { codeHash: row.codeHash, claimant: { id: row.tgId, username: row.tgUsername, firstName: row.tgFirstName, lastName: row.tgLastName } };
}

/** What the website shows: a Telegram user who claimed this member's code and said yes in the bot. */
export function getPendingLink(discordId: string, now = Date.now()) {
    return findPending(discordId, now);
}

/** Spend the pending code after the account was linked. False when someone else already spent it. */
export async function markPendingUsed(codeHash: string, now = Date.now()): Promise<boolean> {
    const res = await prisma.telegramLinkCode.updateMany({
        where: { codeHash, usedAt: null, expiresAt: { gt: new Date(now) }, tgConfirmedAt: { not: null } },
        data: { usedAt: new Date(now) },
    });
    return res.count === 1;
}

/** Discard the member's unused codes (cancel). */
export async function cancelPending(discordId: string): Promise<void> {
    await prisma.telegramLinkCode.deleteMany({ where: { discordId, usedAt: null } });
}
