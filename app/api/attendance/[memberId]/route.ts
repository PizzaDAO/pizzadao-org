import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/db";

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
    // Read pre-computed summary directly — no Google Sheets call, no aggregation
    const summary = await prisma.attendanceSummary.findFirst({
      where: { memberId },
    });

    if (!summary) {
      return NextResponse.json({
        totalCalls: 0,
        crewBreakdown: {},
        recentCalls: [],
      }, {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        },
      });
    }

    return NextResponse.json({
      totalCalls: summary.totalCalls,
      crewBreakdown: summary.crewBreakdown,
      recentCalls: summary.recentCalls,
    }, {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    console.error("[attendance] GET error:", err);
    return NextResponse.json(
      { error: "Failed to fetch attendance data" },
      { status: 500 }
    );
  }
}
