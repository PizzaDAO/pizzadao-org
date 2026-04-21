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
      return NextResponse.json({ claimed: false });
    }

    const claim = await prisma.unlockTicketClaim.findUnique({
      where: { discordId: member.discordId },
      include: { tickets: true },
    });

    if (!claim) {
      return NextResponse.json({ claimed: false });
    }

    return NextResponse.json({
      claimed: true,
      claimId: claim.id,
      ticketCount: claim.ticketCount,
      pointsAwarded: claim.pointsAwarded,
      claimedAt: claim.claimedAt,
      tickets: claim.tickets.map((t) => ({
        eventName: t.eventName,
        networkId: t.networkId,
        lockAddress: t.lockAddress,
        tokenId: t.tokenId,
      })),
    });
  } catch (error) {
    console.error("Error fetching unlock tickets:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
