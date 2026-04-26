import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/db";

export const runtime = "nodejs";

/**
 * GET /api/wallet/public?memberId=123
 * Public endpoint — returns wallet addresses for display on public profiles.
 * Only exposes: walletAddress, chainType, label, isPrimary (no IDs or internal fields).
 */
export async function GET(request: NextRequest) {
  const memberId = request.nextUrl.searchParams.get("memberId");
  if (!memberId) {
    return NextResponse.json({ error: "Missing memberId" }, { status: 400 });
  }

  try {
    const wallets = await prisma.memberWallet.findMany({
      where: { memberId },
      select: {
        walletAddress: true,
        chainType: true,
        label: true,
        isPrimary: true,
      },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });

    return NextResponse.json({ wallets });
  } catch {
    return NextResponse.json({ wallets: [] });
  }
}
