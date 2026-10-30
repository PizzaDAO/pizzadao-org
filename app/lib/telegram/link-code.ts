// app/lib/telegram/link-code.ts
//
// Single-use codes for "Link with the Telegram app". The code travels in t.me/<login bot>?start=<code>
// (Telegram allows 64 chars of [A-Za-z0-9_-]); 32 random bytes in base64url is 43. Only the sha256 is stored.

import { createHash, randomBytes } from "crypto";
import { prisma } from "@/app/lib/db";

export const LINK_CODE_TTL_MS = 10 * 60 * 1000;
const CODE_RE = /^[A-Za-z0-9_-]{43}$/;

export function hashLinkCode(code: string): string {
    return createHash("sha256").update(code).digest("hex");
}

export function isLinkCodeShape(code: string): boolean {
    return CODE_RE.test(code);
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

/** Atomically spend a code. Returns the member it belongs to, or null if unknown, used or expired. */
export async function consumeLinkCode(code: string, now = Date.now()): Promise<string | null> {
    if (!isLinkCodeShape(code)) return null;
    const codeHash = hashLinkCode(code);
    const row = await prisma.telegramLinkCode.findUnique({ where: { codeHash }, select: { discordId: true } });
    if (!row) return null;
    const res = await prisma.telegramLinkCode.updateMany({
        where: { codeHash, usedAt: null, expiresAt: { gt: new Date(now) } },
        data: { usedAt: new Date(now) },
    });
    return res.count === 1 ? row.discordId : null;
}
