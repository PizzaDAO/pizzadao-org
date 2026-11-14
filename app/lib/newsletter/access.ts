// app/lib/newsletter/access.ts
//
// Who may open a newsletter issue: app admins (full editor) and approvers (read-only view plus
// approve / unapprove). Everyone else is refused.
import { NextResponse } from "next/server";
import { isAdminDiscordId, requireSession } from "@/app/lib/auth-guards";
import { loadSettings, type Settings } from "@/app/lib/settings";
import { isApprover } from "./issue";

export type Viewer = "admin" | "approver";

export async function viewerAccess(discordId: string, settings?: Settings): Promise<Viewer | null> {
  if (await isAdminDiscordId(discordId)) return "admin";
  return (await isApprover(discordId, settings ?? (await loadSettings()))) ? "approver" : null;
}

export async function requireViewer(): Promise<{ ok: true; discordId: string; viewer: Viewer } | { ok: false; response: NextResponse }> {
  const auth = await requireSession();
  if (!auth.ok) return auth;
  const viewer = await viewerAccess(auth.session.discordId);
  if (!viewer) return { ok: false, response: NextResponse.json({ error: "Admin or approver access required" }, { status: 403 }) };
  return { ok: true, discordId: auth.session.discordId, viewer };
}
