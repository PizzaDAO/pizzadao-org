import { NextResponse } from "next/server";
import { fetchMemberById } from "@/app/lib/sheets/member-repository";
import { getAttendanceForMember } from "@/app/lib/attendance";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ memberId: string }> }
) {
  const { memberId } = await params;

  if (!memberId) {
    return NextResponse.json(
      { error: "Missing memberId" },
      { status: 400 }
    );
  }

  try {
    // Resolve memberId to discordId via the member sheet
    const member = await fetchMemberById(memberId);
    if (!member) {
      return NextResponse.json(
        { error: "Member not found" },
        { status: 404 }
      );
    }

    const discordId = member.discordId;
    if (!discordId) {
      // Member exists but has no Discord ID — return empty result
      return NextResponse.json({
        totalCalls: 0,
        crewBreakdown: {},
        recentCalls: [],
      });
    }

    const attendance = await getAttendanceForMember(discordId);
    return NextResponse.json(attendance);
  } catch (err) {
    console.error("[attendance] GET error:", err);
    return NextResponse.json(
      { error: "Failed to fetch attendance data" },
      { status: 500 }
    );
  }
}
