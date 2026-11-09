import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ crewId: string; date: string }> }
) {
  const { crewId, date } = await params;

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Invalid date format" }, { status: 400 });
  }

  // Get attendees for this specific call
  const attendeesRaw: {
    discordId: string;
    displayName: string | null;
    crewLabel: string;
    presentSec: number | null;
  }[] = await prisma.$queryRawUnsafe(
    `SELECT "discordId", "displayName", "crewLabel", "presentSec"
     FROM "CallAttendance"
     WHERE "crewId" = $1 AND "callDate"::date = $2::date
     ORDER BY "displayName" ASC NULLS LAST`,
    crewId,
    date
  );

  if (attendeesRaw.length === 0) {
    return NextResponse.json({ error: "Call not found" }, { status: 404 });
  }

  // Batch lookup discordId -> memberId via AttendanceSummary
  const discordIds = attendeesRaw.map((a) => a.discordId);
  const placeholders = discordIds.map((_, i) => `$${i + 1}`).join(",");

  const memberMappings: { discordId: string; memberId: string | null }[] =
    await prisma.$queryRawUnsafe(
      `SELECT "discordId", "memberId" FROM "AttendanceSummary"
       WHERE "discordId" IN (${placeholders})`,
      ...discordIds
    );

  const memberMap = new Map(memberMappings.map((m) => [m.discordId, m.memberId]));

  const attendees = attendeesRaw.map((a) => ({
    discordId: a.discordId,
    displayName: a.displayName || a.discordId,
    memberId: memberMap.get(a.discordId) || null,
    // Whole minutes in the call when a recording measured it (never sheet rows).
    minutes: a.presentSec == null ? null : Math.max(1, Math.round(a.presentSec / 60)),
  }));

  return NextResponse.json(
    {
      crewId,
      crewLabel: attendeesRaw[0].crewLabel,
      date,
      attendeeCount: attendees.length,
      attendees,
    },
    {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=300" },
    }
  );
}
