// app/api/admin/support/tickets/[id]/route.ts
//
// Admin update of a support ticket (buffalo-96244): { status?, adminNotes? }.

import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/db";
import { requireAdmin } from "@/app/lib/auth-guards";
import { parseAdminUpdate, toAdminTicket } from "@/app/lib/support-tickets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const admin = await requireAdmin();
    if (!admin.ok) return admin.response;

    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) {
        return NextResponse.json({ error: "Invalid ticket id" }, { status: 400 });
    }

    const parsed = parseAdminUpdate(await req.json().catch(() => null));
    if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400 });
    }

    const existing = await prisma.supportTicket.findUnique({ where: { id }, select: { status: true } });
    if (!existing) {
        return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    const { status, adminNotes } = parsed.value;
    const data: { status?: typeof status; adminNotes?: string | null; closedAt?: Date | null } = {};
    if (adminNotes !== undefined) data.adminNotes = adminNotes;
    if (status !== undefined && status !== existing.status) {
        data.status = status;
        data.closedAt = status === "CLOSED" ? new Date() : null;
    }

    const ticket = await prisma.supportTicket.update({ where: { id }, data });
    return NextResponse.json({ ok: true, ticket: toAdminTicket(ticket) });
}
