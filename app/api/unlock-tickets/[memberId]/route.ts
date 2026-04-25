import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/db";
import { fetchMemberById } from "@/app/lib/sheets/member-repository";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ memberId: string }> }
) {
  try {
    const { memberId } = await params;
    if (!memberId) {
      return NextResponse.json({ error: "Missing memberId" }, { status: 400 });
    }

    // Resolve memberId to discordId
    const member = await fetchMemberById(memberId);
    if (!member?.discordId) {
      return NextResponse.json({ wallets: [], totalTickets: 0 });
    }

    const claims = await prisma.unlockTicketClaim.findMany({
      where: { discordId: member.discordId },
      include: { tickets: true },
      orderBy: { connectedAt: "desc" },
    });

    if (claims.length === 0) {
      return NextResponse.json({ wallets: [], totalTickets: 0 });
    }

    const wallets = claims.map((c) => ({
      id: c.id,
      walletAddress: c.walletAddress,
      ticketCount: c.ticketCount,
      connectedAt: c.connectedAt,
      tickets: c.tickets.map((t) => ({
        eventName: t.eventName,
        networkId: t.networkId,
        lockAddress: t.lockAddress,
        tokenId: t.tokenId,
      })),
    }));

    const totalTickets = claims.reduce((sum, c) => sum + c.ticketCount, 0);

    return NextResponse.json({ wallets, totalTickets });
  } catch (error) {
    console.error("Error fetching unlock tickets:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
