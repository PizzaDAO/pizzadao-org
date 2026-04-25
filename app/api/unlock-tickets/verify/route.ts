import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { fetchMemberIdByDiscordId } from "@/app/lib/sheets/member-repository";
import { findTicketsForWallet } from "@/app/lib/unlock/subgraph";
import contracts from "@/data/gpp-contracts.json";

export async function GET() {
  try {
    const session = await getSession();
    if (!session?.discordId || !session?.unlockWallet) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const memberId = await fetchMemberIdByDiscordId(session.discordId);
    if (!memberId) {
      return NextResponse.json(
        { error: "Member not found" },
        { status: 404 }
      );
    }

    // Check if this wallet is already connected
    const existing = await prisma.unlockTicketClaim.findUnique({
      where: { walletAddress: session.unlockWallet },
      include: { tickets: true },
    });

    if (existing) {
      return NextResponse.json({
        walletAddress: existing.walletAddress,
        ticketCount: existing.ticketCount,
        alreadyConnected: true,
        tickets: existing.tickets.map((t) => ({
          lockAddress: t.lockAddress,
          networkId: t.networkId,
          eventName: t.eventName,
          tokenId: t.tokenId,
        })),
      });
    }

    // Query subgraphs for tickets
    const tickets = await findTicketsForWallet(session.unlockWallet, contracts);

    // Auto-save: create the claim record and ticket records
    const claim = await prisma.unlockTicketClaim.create({
      data: {
        discordId: session.discordId,
        memberId,
        walletAddress: session.unlockWallet,
        ticketCount: tickets.length,
        tickets: {
          create: tickets.map((t) => ({
            lockAddress: t.lockAddress,
            networkId: t.networkId,
            eventName: t.eventName,
            tokenId: t.tokenId,
          })),
        },
      },
      include: { tickets: true },
    });

    return NextResponse.json({
      walletAddress: claim.walletAddress,
      ticketCount: claim.ticketCount,
      alreadyConnected: false,
      tickets: claim.tickets.map((t) => ({
        lockAddress: t.lockAddress,
        networkId: t.networkId,
        eventName: t.eventName,
        tokenId: t.tokenId,
      })),
    });
  } catch (error) {
    console.error("Error connecting unlock wallet:", error);
    if (
      error instanceof Error &&
      error.message.includes("Unique constraint")
    ) {
      return NextResponse.json(
        { error: "This wallet is already connected" },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
