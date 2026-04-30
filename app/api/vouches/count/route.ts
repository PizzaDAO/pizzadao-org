import { NextRequest, NextResponse } from "next/server";
import { getVouchCounts } from "@/app/lib/vouches";

export const runtime = "nodejs";

/**
 * GET /api/vouches/count?memberId=X
 * Public - returns vouch counts by source
 */
export async function GET(req: NextRequest) {
  const memberId = req.nextUrl.searchParams.get("memberId");
  if (!memberId) {
    return NextResponse.json({ error: "Missing memberId" }, { status: 400 });
  }

  try {
    const counts = await getVouchCounts(memberId);
    return NextResponse.json(counts);
  } catch (err: unknown) {
    console.error("Failed to fetch vouch counts:", err);
    return NextResponse.json(
      { error: "Failed to fetch vouch counts" },
      { status: 500 }
    );
  }
}
