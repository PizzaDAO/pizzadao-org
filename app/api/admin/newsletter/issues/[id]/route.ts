// GET   /api/admin/newsletter/issues/[id]  (admin): the issue, its preview, approval blockers and pick lists.
// PATCH /api/admin/newsletter/issues/[id]  (admin): edit any field. Editing an approved issue returns it to draft.
import { NextResponse } from "next/server";
import { requireAdmin } from "@/app/lib/auth-guards";
import { internalError } from "@/app/lib/errors/error-response";
import { updateIssue } from "@/app/lib/newsletter/issue";
import { dateAtNoonUtc, errorResponse, issueView, patchSchema } from "@/app/lib/newsletter/admin-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(_req: Request, ctx: Ctx) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  try {
    const { id } = await ctx.params;
    return NextResponse.json(await issueView(id, admin.session.discordId), { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err) ?? internalError(err, "admin/newsletter/issue", "Couldn't load the issue");
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const admin = await requireAdmin();
  if (!admin.ok) return admin.response;
  try {
    const { id } = await ctx.params;
    const parsed = patchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid edit" }, { status: 400 });
    const b = parsed.data;
    const issueDate = b.issueDate ? dateAtNoonUtc(b.issueDate) : undefined;
    if (b.issueDate && !issueDate) return NextResponse.json({ error: "Not a valid date" }, { status: 400 });
    await updateIssue(
      id,
      {
        subject: b.subject,
        preheader: b.preheader,
        issueDate: issueDate ?? undefined,
        xSpaceUrl: b.xSpaceUrl,
        sections: b.sections,
        sponsorNotified: b.sponsorNotified,
        pickMember: b.pickMember,
        pickCity: b.pickCity,
      },
      admin.session.discordId,
    );
    return NextResponse.json(await issueView(id, admin.session.discordId), { headers: NO_STORE });
  } catch (err) {
    return errorResponse(err) ?? internalError(err, "admin/newsletter/issue", "Couldn't save the issue");
  }
}
