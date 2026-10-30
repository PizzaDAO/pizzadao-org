// app/lib/telegram/link-account.ts
//
// Store a Telegram account as the login of a member. Shared by the Login Widget route and the
// login bot's /start link, so both behave the same: one Telegram account per member, and a login
// always wins over a suggested host match.

import { prisma } from "@/app/lib/db";
import { fetchMemberIdByDiscordId } from "@/app/lib/sheets/member-repository";

export interface LinkableTelegramUser {
    id: string;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
    photoUrl: string | null;
    authDate: Date;
}

export async function linkTelegramAccount(discordId: string, tg: LinkableTelegramUser): Promise<"linked" | "conflict"> {
    // One Telegram account per member: refuse if it's already linked elsewhere.
    const existing = await prisma.telegramAccount.findUnique({
        where: { telegramId: tg.id },
        select: { discordId: true },
    });
    if (existing && existing.discordId !== discordId) return "conflict";

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
        if ((e as { code?: string })?.code === "P2002") return "conflict";
        throw e;
    }

    // A Telegram login always wins over a suggested host match: drop the suggestion for this member.
    // The same Telegram id suggested to anyone else is now someone's login: drop those suggestions too.
    await prisma.telegramHostMatch.deleteMany({ where: { OR: [{ discordId }, { telegramId: tg.id }] } }).catch(() => undefined);
    return "linked";
}
