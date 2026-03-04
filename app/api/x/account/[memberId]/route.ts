import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/db";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ memberId: string }> }
) {
  const { memberId } = await params;

  const account = await (prisma as any).xAccount.findFirst({
    where: { memberId },
    select: {
      xUsername: true,
      xDisplayName: true,
      xProfileImageUrl: true,
    },
  });

  if (!account) {
    return NextResponse.json({ connected: false });
  }

  return NextResponse.json({
    connected: true,
    username: account.xUsername,
    displayName: account.xDisplayName,
    profileImageUrl: account.xProfileImageUrl,
  });
}
