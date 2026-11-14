// POST /api/admin/newsletter/issues/[id]/unapprove (admin): back to draft, approval cleared.
import { NextResponse } from "next/server";
import { requireAdmin } from "@/app/lib/auth-guards";
import { internalError } from "@/app/lib/errors/error-response";
import { unapproveIssue } from "@/app/lib/newsletter/issue";
import { errorResponse, issueView } from "@/app/lib/newsletter/admin-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  try {
    const { id } = await ctx.params;
    await unapproveIssue(id, admin.session.discordId);
    return NextResponse.json(await issueView(id, admin.session.discordId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return errorResponse(err) ?? internalError(err, "admin/newsletter/unapprove", "Couldn't unapprove the issue");
  }
}
