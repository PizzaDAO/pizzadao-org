import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { fetchMemberIdByDiscordId } from "@/app/lib/sheets/member-repository";
import { findTicketsForWallet } from "@/app/lib/unlock/subgraph";
import contracts from "@/data/gpp-contracts.json";

const POINTS_PER_TICKET = 1000;

export async function POST() {
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

    // Check if discordId already claimed
    const existingByDiscord = await prisma.unlockTicketClaim.findUnique({
      where: { discordId: session.discordId },
    });
    if (existingByDiscord) {
      return NextResponse.json(
        { error: "Already claimed with this Discord account" },
        { status: 409 }
      );
    }

    // Check if wallet already claimed
    const existingByWallet = await prisma.unlockTicketClaim.findUnique({
      where: { walletAddress: session.unlockWallet },
    });
    if (existingByWallet) {
      return NextResponse.json(
        { error: "Already claimed with this wallet" },
        { status: 409 }
      );
    }

    // Re-query subgraphs for TOCTOU safety
    const tickets = await findTicketsForWallet(session.unlockWallet, contracts);

    if (tickets.length === 0) {
      return NextResponse.json(
        { error: "No tickets found for this wallet" },
        { status: 404 }
      );
    }

    const pointsAwarded = tickets.length * POINTS_PER_TICKET;

    const claim = await prisma.unlockTicketClaim.create({
      data: {
        discordId: session.discordId,
        memberId,
        walletAddress: session.unlockWallet,
        ticketCount: tickets.length,
        pointsAwarded,
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
      success: true,
      claimId: claim.id,
      ticketCount: claim.ticketCount,
      pointsAwarded: claim.pointsAwarded,
    });
  } catch (error) {
    console.error("Error claiming unlock tickets:", error);
    // Handle unique constraint violations
    if (
      error instanceof Error &&
      error.message.includes("Unique constraint")
    ) {
      return NextResponse.json(
        { error: "Ticket already claimed" },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
