// POST /api/admin/newsletter/issues/[id]/redraft (admin): have the model rewrite the wording of the
// current sections (needs newsletter.draftEnabled). Counts as an edit: an approved issue returns to draft.
import { NextResponse } from "next/server";
import { requireAdmin } from "@/app/lib/auth-guards";
import { internalError } from "@/app/lib/errors/error-response";
import { redraftText } from "@/app/lib/newsletter/issue";
import { errorResponse, issueView } from "@/app/lib/newsletter/admin-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  try {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => null)) as { updatedAt?: unknown } | null;
    await redraftText(id, admin.session.discordId, new Date(typeof body?.updatedAt === "string" ? body.updatedAt : NaN));
    return NextResponse.json(await issueView(id, admin.session.discordId), { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return errorResponse(err) ?? internalError(err, "admin/newsletter/redraft", "Couldn't redraft the issue");
  }
}
