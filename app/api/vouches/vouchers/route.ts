import { NextRequest, NextResponse } from "next/server";
import { getVouchers, getVouchCounts } from "@/app/lib/vouches";
import { toggleEnabled } from "@/app/lib/settings/toggles";

export const runtime = "nodejs";

const MAX = 24;

/**
 * GET /api/vouches/vouchers?memberId=X — how many members vouched for X, and who (the profile's
 * "Vouched for by" block). Public like the rest of the vouch lists. While the setting
 * vouches.showVouchersEnabled is off (env VOUCH_SHOW_VOUCHERS_ENABLED) it answers { enabled: false }
 * and nothing else. Only PizzaDAO vouches count here (imported Farcaster / X follows are not members vouching).
 */
export async function GET(req: NextRequest) {
  const memberId = req.nextUrl.searchParams.get("memberId")?.trim();
  if (!memberId || !/^\d{1,10}$/.test(memberId)) {
    return NextResponse.json({ error: "Missing memberId" }, { status: 400 });
  }
  try {
    if (!(await toggleEnabled("vouches.showVouchersEnabled"))) {
      return NextResponse.json({ enabled: false }, { headers: { "Cache-Control": "public, s-maxage=30" } });
    }
    const [vouchers, counts] = await Promise.all([getVouchers(memberId, MAX, "PIZZADAO"), getVouchCounts(memberId)]);
    return NextResponse.json(
      {
        enabled: true,
        total: counts.pizzadaoFollowers,
        vouchers: vouchers.map((v) => ({ memberId: v.memberId, name: v.name, city: v.city })),
      },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
    );
  } catch (err) {
    console.error("[vouches/vouchers] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to load vouchers" }, { status: 500 });
  }
}
