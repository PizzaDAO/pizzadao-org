import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/auth-guards";
import { canAnnounce, requireAnnouncer } from "@/app/lib/announce/access";
import { runAnnouncementFromEnv } from "@/app/lib/announce/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/announce - whether the logged-in user may fire the announcement.
// Lets the page decide what to show without shipping the access list.
export async function GET() {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const allowed = await canAnnounce(auth.session.discordId);
  return NextResponse.json({ allowed });
}

// POST /api/announce - fire the Community Call announcement.
// Discord login + announce role enforced server-side; the Discord post and the
// sheet status update both happen here (no Apps Script in the path).
export async function POST() {
  const auth = await requireAnnouncer();
  if (!auth.ok) return auth.response;

  // Audit trail: who fired the blast.
  console.log(
    `[announce] fired by discordId=${auth.session.discordId} username=${
      auth.session.username ?? "unknown"
    } at ${new Date().toISOString()}`,
  );

  try {
    const result = await runAnnouncementFromEnv();
    if (result.status >= 400) {
      console.error(`[announce] failed (${result.status}): ${result.body.error ?? "unknown error"}`);
    }
    return NextResponse.json(result.body, { status: result.status });
  } catch (e: unknown) {
    console.error("[announce] unexpected failure", e);
    return NextResponse.json({ success: false, error: "Announcement failed unexpectedly" }, { status: 500 });
  }
}
