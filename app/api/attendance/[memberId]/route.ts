import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/db";
import { fetchMemberById } from "@/app/lib/sheets/member-repository";

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
};

const EMPTY_RESPONSE = { totalCalls: 0, crewBreakdown: {}, recentCalls: [] };

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
    // 1. Try direct lookup by memberId
    let summary = await prisma.attendanceSummary.findFirst({
      where: { memberId },
    });

    // 2. If not found, resolve memberId → discordId and try by discordId
    //    This handles cases where the summary exists but memberId wasn't linked yet
    if (!summary) {
      const member = await fetchMemberById(memberId);
      const discordId = member?.discordId;

      if (discordId) {
        summary = await prisma.attendanceSummary.findUnique({
          where: { discordId },
        });

        // Backfill the memberId so future lookups are instant
        if (summary && !summary.memberId) {
          await prisma.attendanceSummary.update({
            where: { discordId },
            data: { memberId },
          });
        }
      }
    }

    if (!summary) {
      return NextResponse.json(EMPTY_RESPONSE, { headers: CACHE_HEADERS });
    }

    return NextResponse.json({
      totalCalls: summary.totalCalls,
      crewBreakdown: summary.crewBreakdown,
      recentCalls: summary.recentCalls,
    }, {
      headers: CACHE_HEADERS,
    });
  } catch (err) {
    console.error("[attendance] GET error:", err);
    return NextResponse.json(
      { error: "Failed to fetch attendance data" },
      { status: 500 }
    );
  }
}
