// NFT Leaderboard Cache Refresh Endpoint
import { NextResponse } from "next/server";
import { cacheDel } from "../../../lib/cache";

export const runtime = "nodejs";

const CACHE_KEY = "nft-leaderboard:v1";

export async function POST() {
  try {
    await cacheDel(CACHE_KEY);
    console.log("[leaderboard] Cache cleared");
    return NextResponse.json({ ok: true, message: "Cache cleared" });
  } catch (error) {
    console.error("[leaderboard] Error clearing cache:", error);
    return NextResponse.json(
      { ok: false, error: "Failed to clear cache" },
      { status: 500 }
    );
  }
}
