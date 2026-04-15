import { NextResponse } from "next/server";
import { getMafiaPoints } from "@/app/lib/mafia-points";

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
    const result = await getMafiaPoints(memberId);
    return NextResponse.json(result);
  } catch (e: unknown) {
    console.error("Mafia points error:", e);
    return NextResponse.json(
      { error: "Failed to calculate mafia points" },
      { status: 500 },
    );
  }
}
