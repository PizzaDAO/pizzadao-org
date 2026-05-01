import { NextRequest, NextResponse } from "next/server";
import { getVouches, VouchSource, getVouchCounts } from "@/app/lib/vouches";

export const runtime = "nodejs";

const VALID_SOURCES: VouchSource[] = ["PIZZADAO", "TWITTER", "FARCASTER"];

/**
 * GET /api/vouches?memberId=X&limit=N&source=PIZZADAO
 * Public - returns vouches list for a member
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

  try {
    const [vouches, counts] = await Promise.all([
      getVouches(memberId, limit, source),
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
