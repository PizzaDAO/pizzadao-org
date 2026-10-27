// app/api/email-prefs/route.ts
//
// The signed-in member's weekly-email preference (the toggle on the profile
// edit page). GET -> { weekly: boolean }, POST { weekly: boolean }.
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/app/lib/auth-guards";
import { prisma } from "@/app/lib/db";
import { fetchMemberIdByDiscordId } from "@/app/lib/sheets/member-repository";
import { internalError } from "@/app/lib/errors/error-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function memberFor(discordId: string): Promise<string | null> {
  return fetchMemberIdByDiscordId(discordId).catch(() => null);
}

export async function GET() {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  try {
    const memberId = await memberFor(auth.session.discordId);
    if (!memberId) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    const row = await prisma.memberProfileExtras.findUnique({
      where: { memberId },
      select: { reengageEmailOptOut: true },
    });
    return NextResponse.json({ weekly: !row?.reengageEmailOptOut });
  } catch (err) {
    return internalError(err, "email-prefs GET", "Couldn't load email preference");
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;
  let body: { weekly?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    // fall through to validation
  }
  if (typeof body.weekly !== "boolean") {
    return NextResponse.json({ error: "weekly must be a boolean" }, { status: 400 });
  }
  try {
    const memberId = await memberFor(auth.session.discordId);
    if (!memberId) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    const optOut = !body.weekly;
    await prisma.memberProfileExtras.upsert({
      where: { memberId },
      create: { memberId, reengageEmailOptOut: optOut },
      update: { reengageEmailOptOut: optOut },
    });
    return NextResponse.json({ weekly: body.weekly });
  } catch (err) {
    return internalError(err, "email-prefs POST", "Couldn't save email preference");
  }
}
