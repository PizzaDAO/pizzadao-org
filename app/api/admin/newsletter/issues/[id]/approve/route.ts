// POST /api/admin/newsletter/issues/[id]/approve: approve a draft. Only members who may approve
// (setting newsletter.approverRoleIds; empty means app admins) can do this; the check is in approveIssue().
import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/auth-guards";
import { internalError } from "@/app/lib/errors/error-response";
import { loadSettings } from "@/app/lib/settings";
import { approveIssue } from "@/app/lib/newsletter/issue";
import { errorResponse, issueView } from "@/app/lib/newsletter/admin-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  try {
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => null)) as { updatedAt?: unknown } | null;
    const expected = typeof body?.updatedAt === "string" ? new Date(body.updatedAt) : undefined;
    const settings = await loadSettings();
    await approveIssue(id, auth.session.discordId, settings, expected);
    return NextResponse.json(await issueView(id, auth.session.discordId, settings), { headers: { "Cache-Control": "private, no-store" } });
  } catch (err) {
    return errorResponse(err) ?? internalError(err, "admin/newsletter/approve", "Couldn't approve the issue");
  }
}
