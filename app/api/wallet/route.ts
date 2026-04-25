import { NextRequest, NextResponse } from "next/server";
import { writeToSheet } from "../profile/route";
import { saveWalletForMember } from "@/app/lib/wallet-lookup";

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

    // Save to DB for fast lookups
    await saveWalletForMember(String(memberId), walletAddress, "wallet_connect");

    // Also write to Google Sheet for backward compatibility
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

    return NextResponse.json({
      success: true,
      message: "Wallet address saved",
      walletAddress,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to save wallet address" },
      { status: 500 }
    );
  }
}
