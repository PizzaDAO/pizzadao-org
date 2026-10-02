// app/api/support/tickets/route.ts
//
// Member support tickets (buffalo-96244).
//   GET  -> the caller's tickets, newest first (admin notes omitted)
//   POST -> { subject, body } creates a ticket and pings Discord (best-effort)

import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/db";
import { requireSession } from "@/app/lib/auth-guards";
import { fetchMemberIdByDiscordId } from "@/app/lib/sheets/member-repository";
import {
    MAX_OPEN_TICKETS,
    MAX_TICKETS_PER_DAY,
    notifyNewTicket,
    parseTicketInput,
    toMemberTicket,
} from "@/app/lib/support-tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET() {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;

    const tickets = await prisma.supportTicket.findMany({
        where: { discordId: auth.session.discordId },
        orderBy: { createdAt: "desc" },
        take: 100,
    });
    return NextResponse.json({ tickets: tickets.map(toMemberTicket) }, { headers: NO_STORE });
}

export async function POST(req: Request) {
    const auth = await requireSession();
    if (!auth.ok) return auth.response;
    const { session } = auth;

    const parsed = parseTicketInput(await req.json().catch(() => null));
    if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400 });
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [recent, open] = await Promise.all([
        prisma.supportTicket.count({ where: { discordId: session.discordId, createdAt: { gte: since } } }),
        prisma.supportTicket.count({ where: { discordId: session.discordId, status: { not: "CLOSED" } } }),
    ]);
    if (recent >= MAX_TICKETS_PER_DAY) {
        return NextResponse.json(
            { error: `You can open at most ${MAX_TICKETS_PER_DAY} tickets per day. Please try again later.` },
            { status: 429 },
        );
    }
    if (open >= MAX_OPEN_TICKETS) {
        return NextResponse.json(
            { error: `You already have ${MAX_OPEN_TICKETS} unresolved tickets. Please wait for those to be handled.` },
            { status: 429 },
        );
    }

    let memberId: string | null = null;
    try {
        memberId = await fetchMemberIdByDiscordId(session.discordId);
    } catch {
        // Best-effort.
    }
    const displayName = (session.nick || session.username || "").slice(0, 100) || null;

    const ticket = await prisma.supportTicket.create({
        data: {
            discordId: session.discordId,
            memberId,
            displayName,
            subject: parsed.value.subject,
            body: parsed.value.body,
        },
    });

    // Never fail the request on a webhook problem.
    await notifyNewTicket(ticket);

    return NextResponse.json({ ok: true, ticket: toMemberTicket(ticket) }, { status: 201 });
}
