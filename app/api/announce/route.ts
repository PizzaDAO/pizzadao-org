import { NextResponse } from "next/server";
import { requireSession } from "@/app/lib/auth-guards";
import { canAnnounce, requireAnnouncer } from "@/app/lib/announce/access";
import { runAnnouncementFromEnv } from "@/app/lib/announce/run";
import { getAnnounceBotCheck } from "@/app/lib/announce/bot-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The SecretService call (Discord event + tweet + attendance) can take a while.
export const maxDuration = 120;

// GET /api/announce - whether the logged-in user may fire the announcement.
// Lets the page decide what to show without shipping the access list.
// For announcers it also returns `botCheck`: whether the bot can view / post /
// mention @everyone in the announcement channel (cached 5 min).
export async function GET() {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  const allowed = await canAnnounce(auth.session.discordId);
  if (!allowed) return NextResponse.json({ allowed });
  const botCheck = await getAnnounceBotCheck();
  return NextResponse.json({ allowed, botCheck });
}

// POST /api/announce - fire the Community Call announcement.
// Discord login + announce role enforced server-side; the Discord post and the
// sheet status update happen here, then SecretService (Apps Script) is called
// with Discord posts disabled to start the event, tweet and take attendance.
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
