// app/api/admin/support/tickets/route.ts
//
// Admin list of support tickets (buffalo-96244). Optional ?status=OPEN|IN_PROGRESS|CLOSED.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/db";
import { requireAdmin } from "@/app/lib/auth-guards";
import { isSupportStatus, toAdminTicket } from "@/app/lib/support-tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    const admin = await requireAdmin();
    if (!admin.ok) return admin.response;

    const rawStatus = req.nextUrl.searchParams.get("status");
    if (rawStatus && !isSupportStatus(rawStatus)) {
        return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    const status = rawStatus && isSupportStatus(rawStatus) ? rawStatus : null;

    const tickets = await prisma.supportTicket.findMany({
        where: status ? { status } : undefined,
        orderBy: { createdAt: "desc" },
        take: 200,
    });
    return NextResponse.json(
        { tickets: tickets.map(toAdminTicket) },
        { headers: { "Cache-Control": "private, no-store" } },
    );
}
