import { NextRequest, NextResponse } from "next/server";
import { getFriends, FriendSource, getFriendCounts } from "@/app/lib/friends";

export const runtime = "nodejs";

const VALID_SOURCES: FriendSource[] = ["PIZZADAO", "TWITTER", "FARCASTER"];

/**
 * GET /api/friends?memberId=X&limit=N&source=PIZZADAO
 * Public - returns friends list for a member
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
    sourceStr && VALID_SOURCES.includes(sourceStr as FriendSource)
      ? (sourceStr as FriendSource)
      : undefined;

  try {
    const [friends, counts] = await Promise.all([
      getFriends(memberId, limit, source),
      getFriendCounts(memberId),
    ]);

    return NextResponse.json({ friends, counts });
  } catch (err: unknown) {
    console.error("Failed to fetch friends:", err);
    return NextResponse.json(
      { error: "Failed to fetch friends" },
      { status: 500 }
    );
  }
}
