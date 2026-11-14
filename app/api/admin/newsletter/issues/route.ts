// GET  /api/admin/newsletter/issues  (admin): the issues, newest first.
// POST /api/admin/newsletter/issues  (admin) { issueDate?: "YYYY-MM-DD" }: gather the data for the
// period since the last sent issue and create a draft. Nothing is sent.
import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/db";
import { requireAdmin } from "@/app/lib/auth-guards";
import { internalError } from "@/app/lib/errors/error-response";
import { createDraft } from "@/app/lib/newsletter/issue";
import { dateAtNoonUtc, errorResponse } from "@/app/lib/newsletter/admin-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  try {
    const rows = await prisma.newsletterIssue.findMany({
      orderBy: { issueDate: "desc" },
      take: 50,
      select: { id: true, slug: true, status: true, subject: true, issueDate: true, approvedAt: true, updatedAt: true },
    });
    return NextResponse.json(
      { issues: rows.map((r) => ({ ...r, issueDate: r.issueDate.toISOString().slice(0, 10) })) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    return internalError(err, "admin/newsletter/issues", "Couldn't load the issues");
  }
}

export async function POST(req: Request) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  try {
    const body = (await req.json().catch(() => ({}))) as { issueDate?: unknown };
    const issueDate = typeof body.issueDate === "string" ? dateAtNoonUtc(body.issueDate) : dateAtNoonUtc(new Date().toISOString().slice(0, 10));
    if (!issueDate) return NextResponse.json({ error: "Use a date like 2026-12-22" }, { status: 400 });
    const created = await createDraft({ actor: admin.session.discordId, issueDate });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return errorResponse(err) ?? internalError(err, "admin/newsletter/issues", "Couldn't create the draft");
  }
}
