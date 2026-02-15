import { NextRequest, NextResponse } from "next/server";
import { getFriendCounts } from "@/app/lib/friends";

export const runtime = "nodejs";

/**
 * GET /api/friends/count?memberId=X
 * Public - returns friend counts by source
 */
export async function GET(req: NextRequest) {
  const memberId = req.nextUrl.searchParams.get("memberId");
  if (!memberId) {
    return NextResponse.json({ error: "Missing memberId" }, { status: 400 });
  }

  try {
    const counts = await getFriendCounts(memberId);
    return NextResponse.json(counts);
  } catch (err: unknown) {
    console.error("Failed to fetch friend counts:", err);
    return NextResponse.json(
      { error: "Failed to fetch friend counts" },
      { status: 500 }
    );
  }
}
