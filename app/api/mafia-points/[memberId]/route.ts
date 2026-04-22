import { NextResponse } from "next/server";
import { getMafiaRank } from "@/app/lib/mafia-points";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ memberId: string }> },
) {
  const { memberId } = await params;

  if (!memberId) {
    return NextResponse.json({ error: "Missing memberId" }, { status: 400 });
  }

  try {
    const result = await getMafiaRank(memberId);
    return NextResponse.json({
      memberId: result.memberId,
      memberName: result.memberName,
      rank: result.rank.name,
      lastCalculated: result.lastCalculated,
    });
  } catch (e: unknown) {
    console.error("Mafia rank error:", e);
    return NextResponse.json(
      { error: "Failed to calculate mafia rank" },
      { status: 500 },
    );
  }
}
