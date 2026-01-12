import { NextRequest, NextResponse } from "next/server";
import { writeToSheet } from "../profile/route";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const secret = process.env.GOOGLE_SHEETS_SHARED_SECRET;
    if (!secret) {
      return NextResponse.json({ error: "Missing Sheets webapp env vars" }, { status: 500 });
    }

    const body = await request.json();
    const { memberId, walletAddress } = body;

    if (!memberId) {
      return NextResponse.json({ error: "Missing member ID" }, { status: 400 });
    }

    if (!walletAddress || !walletAddress.startsWith("0x") || walletAddress.length !== 42) {
      return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
    }

    console.log(`[wallet] Saving wallet ${walletAddress} for member ${memberId}`);

    // Use the same writeToSheet approach as profile/auto-claim routes
    // The Apps Script correctly finds rows by ID (not GViz indices which skip hidden rows)
    const payload = {
      secret,
      source: "wallet_connect",
      memberId: String(memberId),
      wallet: walletAddress,
      raw: {
        source: "wallet_connect",
        memberId: String(memberId),
        wallet: walletAddress,
      },
    };

    const result = await writeToSheet(payload);
    console.log(`[wallet] Sheet write result:`, result);

    return NextResponse.json({
      success: true,
      message: "Wallet address saved",
      walletAddress,
    });
  } catch (error) {
    console.error("[wallet] Error saving wallet:", error);
    return NextResponse.json(
      { error: "Failed to save wallet address" },
      { status: 500 }
    );
  }
}
