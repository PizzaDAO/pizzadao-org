import { NextResponse } from "next/server";
import { getSession } from "@/app/lib/session";
import { prisma } from "@/app/lib/db";
import { fetchWithRedirect } from "@/app/lib/sheet-utils";

export const runtime = "nodejs";

export async function DELETE() {
  const session = await getSession();
  if (!session?.discordId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Get memberId before deleting so we can clear the sheet
  const existing = await (prisma as any).xAccount.findUnique({
    where: { discordId: session.discordId },
    select: { memberId: true },
  });

  try {
    await (prisma as any).xAccount.delete({
      where: { discordId: session.discordId },
    });
  } catch (e: any) {
    // Record might not exist, that's fine (P2025 = record not found)
    if (e?.code !== "P2025") throw e;
  }

  // Clear X username from Google Sheet (fire-and-forget)
  const sheetsUrl = process.env.GOOGLE_SHEETS_WEBAPP_URL;
  const sheetsSecret = process.env.GOOGLE_SHEETS_SHARED_SECRET;
  if (sheetsUrl && sheetsSecret && existing?.memberId) {
    fetchWithRedirect(sheetsUrl, {
      secret: sheetsSecret,
      source: "x-disconnect",
      memberId: existing.memberId,
      discordId: session.discordId,
      x: "",
    }).catch(() => {});
  }

  return NextResponse.json({ success: true });
}
