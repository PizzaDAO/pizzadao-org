import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/db";
import { fetchMemberById } from "@/app/lib/sheets/member-repository";

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
};

/**
 * Attach `recordingId` to each recent call that has a PUBLISHED recording (the call page exists
 * only then). Matches CallAttendance rows by date + crew; a lookup failure just leaves the links off.
 */
export async function withRecordingLinks<T extends { date: string; crewId: string }>(
  discordId: string,
  recent: T[],
): Promise<Array<T & { recordingId?: string }>> {
  if (recent.length === 0) return recent;
  try {
    const rows = await prisma.callAttendance.findMany({
      where: {
        discordId,
        recordingId: { not: null },
        callDate: { in: recent.map((c) => new Date(c.date)) },
      },
      select: { recordingId: true, callDate: true, crewId: true },
      orderBy: { createdAt: 'asc' }, // later rows win in the map below: the latest recording
    });
    const ids = [...new Set(rows.map((r) => r.recordingId).filter((x): x is string => !!x))];
    if (ids.length === 0) return recent;
    const published = await prisma.callRecording.findMany({
      where: { id: { in: ids }, publishedAt: { not: null } },
      select: { id: true },
    });
    const ok = new Set(published.map((r) => r.id));
    const byKey = new Map<string, string>();
    for (const r of rows) {
      if (r.recordingId && ok.has(r.recordingId)) byKey.set(`${r.callDate.toISOString()}|${r.crewId}`, r.recordingId);
    }
    return recent.map((c) => {
      const recordingId = byKey.get(`${new Date(c.date).toISOString()}|${c.crewId}`);
      return recordingId ? { ...c, recordingId } : c;
    });
  } catch {
    return recent;
  }
}

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

    const recent = Array.isArray(summary.recentCalls)
      ? await withRecordingLinks(summary.discordId, summary.recentCalls as Array<{ date: string; crewId: string }>)
      : summary.recentCalls;
    return NextResponse.json({
      totalCalls: summary.totalCalls,
      crewBreakdown: summary.crewBreakdown,
      recentCalls: recent,
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
