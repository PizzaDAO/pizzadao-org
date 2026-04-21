import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { findTicketsForWallet } from "@/app/lib/unlock/subgraph";
import contracts from "@/data/gpp-contracts.json";

const POINTS_PER_TICKET = 1000;

export async function GET() {
  try {
    const session = await getSession();
    if (!session?.discordId || !session?.unlockWallet) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const tickets = await findTicketsForWallet(session.unlockWallet, contracts);

    return NextResponse.json({
      walletAddress: session.unlockWallet,
      tickets: tickets.map((t) => ({
        lockAddress: t.lockAddress,
        networkId: t.networkId,
        eventName: t.eventName,
        tokenId: t.tokenId,
      })),
      ticketCount: tickets.length,
      pointsAvailable: tickets.length * POINTS_PER_TICKET,
    });
  } catch (error) {
    console.error("Error verifying unlock tickets:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
