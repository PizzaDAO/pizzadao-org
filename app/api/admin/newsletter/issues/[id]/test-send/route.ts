// POST /api/admin/newsletter/issues/[id]/test-send (admin): email the issue to the signed-in admin's
// own verified address only. There is no recipient parameter.
import { NextResponse } from "next/server";
import { requireAdmin } from "@/app/lib/auth-guards";
import { internalError } from "@/app/lib/errors/error-response";
import { sendTestIssue } from "@/app/lib/newsletter/test-send";
import { errorResponse } from "@/app/lib/newsletter/admin-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  try {
    const { id } = await ctx.params;
    const out = await sendTestIssue(id, admin.session.discordId);
    return out.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: out.error }, { status: out.status });
  } catch (err) {
    return errorResponse(err) ?? internalError(err, "admin/newsletter/test-send", "Couldn't send the test");
  }
}
