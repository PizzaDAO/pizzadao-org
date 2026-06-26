import { NextRequest, NextResponse } from "next/server";
import {
  getVouches,
  getVouchers,
  VouchSource,
  getVouchCounts,
} from "@/app/lib/vouches";

export const runtime = "nodejs";

const VALID_SOURCES: VouchSource[] = ["PIZZADAO", "TWITTER", "FARCASTER"];

/**
 * GET /api/vouches?memberId=X&limit=N&source=PIZZADAO&direction=out|in
 * Public — returns a vouches list for a member.
 *
 * direction=out (default): people the member has vouched for (outbound).
 * direction=in:            people who have vouched for the member (inbound).
 */
export async function GET(req: NextRequest) {
  const memberId = req.nextUrl.searchParams.get("memberId");
  if (!memberId) {
    return NextResponse.json({ error: "Missing memberId" }, { status: 400 });
  }

  const limitStr = req.nextUrl.searchParams.get("limit");
  const limit = limitStr ? Math.min(parseInt(limitStr, 10) || 50, 200) : 50;

  const sourceStr = req.nextUrl.searchParams.get("source");
  const source =
    sourceStr && VALID_SOURCES.includes(sourceStr as VouchSource)
      ? (sourceStr as VouchSource)
      : undefined;

  const direction = req.nextUrl.searchParams.get("direction") === "in" ? "in" : "out";

  try {
    const [vouches, counts] = await Promise.all([
      direction === "in"
        ? getVouchers(memberId, limit, source)
        : getVouches(memberId, limit, source),
      getVouchCounts(memberId),
    ]);

    return NextResponse.json({ vouches, counts }, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' }
    });
  } catch (err: unknown) {
    console.error("Failed to fetch vouches:", err);
    return NextResponse.json(
      { error: "Failed to fetch vouches" },
      { status: 500 }
    );
  }
}
