import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { findMemberByDiscordId } from "@/app/lib/member-utils";
import { toggleEnabled } from "@/app/lib/settings/toggles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * GET /api/vouches/quick — drives the one-click Vouch button on the members list (/crew).
 * Signed-in members only. `enabled` follows the setting vouches.quickVouchEnabled (env
 * VOUCH_QUICK_ENABLED); `vouchedIds` are the members the viewer has already vouched for, so the
 * list can show "Vouched" without a call per card. Off or signed out: { enabled: false }.
 */
export async function GET() {
  try {
    const session = await getSession();
    if (!session?.discordId || !(await toggleEnabled("vouches.quickVouchEnabled"))) {
      return NextResponse.json({ enabled: false, vouchedIds: [] }, { headers: NO_STORE });
    }
    const me = await findMemberByDiscordId(session.discordId);
    if (!me?.memberId) return NextResponse.json({ enabled: false, vouchedIds: [] }, { headers: NO_STORE });
    const rows = await prisma.vouch.findMany({
      where: { followerId: me.memberId },
      select: { followeeId: true },
      take: 5000,
    });
    return NextResponse.json(
      { enabled: true, memberId: me.memberId, vouchedIds: rows.map((r) => r.followeeId) },
      { headers: NO_STORE },
    );
  } catch (err) {
    console.error("[vouches/quick] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ enabled: false, vouchedIds: [] }, { headers: NO_STORE });
  }
}
