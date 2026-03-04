import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";

export const runtime = "nodejs";

export async function DELETE() {
  const session = await getSession();
  if (!session?.discordId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    await (prisma as any).xAccount.delete({
      where: { discordId: session.discordId },
    });
  } catch (e: any) {
    // Record might not exist, that's fine (P2025 = record not found)
    if (e?.code !== "P2025") throw e;
  }

  return NextResponse.json({ success: true });
}
