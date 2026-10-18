// app/api/admin/spotlight/submissions/[id]/route.ts
//
// Admin update of a Mafia Spotlight submission (blackolive-55617):
// { status?, adminNotes?, featuredOn? }. FEATURED without a date defaults to today.

import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/db";
import { requireAdmin } from "@/app/lib/auth-guards";
import { parseAdminUpdate, toAdminSubmission } from "@/app/lib/spotlight";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const admin = await requireAdmin();
    if (!admin.ok) return admin.response;

    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) {
        return NextResponse.json({ error: "Invalid submission id" }, { status: 400 });
    }

    const parsed = parseAdminUpdate(await req.json().catch(() => null));
    if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error, field: parsed.field }, { status: 400 });
    }

    const existing = await prisma.spotlightSubmission.findUnique({
        where: { id },
        select: { status: true, featuredOn: true },
    });
    if (!existing) {
        return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    }

    const data = { ...parsed.value };
    if (data.status === "FEATURED" && data.featuredOn === undefined && !existing.featuredOn) {
        data.featuredOn = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
    }

    const submission = await prisma.spotlightSubmission.update({ where: { id }, data });
    return NextResponse.json({ ok: true, submission: toAdminSubmission(submission) });
}
