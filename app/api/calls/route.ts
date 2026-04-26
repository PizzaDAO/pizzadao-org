import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/db";

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const crewParam = url.searchParams.get("crew"); // comma-separated crew IDs
  const sort = url.searchParams.get("sort") || "newest";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "20", 10)));

  const crewFilter = crewParam
    ? crewParam.split(",").map((c) => c.trim()).filter(Boolean)
    : [];

  const whereClause = crewFilter.length
    ? `WHERE "crewId" IN (${crewFilter.map((_, i) => `$${i + 1}`).join(",")})`
    : "";

  const orderDir = sort === "oldest" ? "ASC" : "DESC";
  const offset = (page - 1) * limit;

  // Get unique calls grouped by crewId + callDate
  const callsQuery = `
    SELECT "crewId", "crewLabel", "callDate"::date as "callDate", COUNT(*)::int as "attendeeCount"
    FROM "CallAttendance"
    ${whereClause}
    GROUP BY "crewId", "crewLabel", "callDate"::date
    ORDER BY "callDate"::date ${orderDir}, "crewLabel" ASC
    LIMIT ${limit} OFFSET ${offset}
  `;

  const countQuery = `
    SELECT COUNT(*)::int as total FROM (
      SELECT 1 FROM "CallAttendance"
      ${whereClause}
      GROUP BY "crewId", "crewLabel", "callDate"::date
    ) sub
  `;

  // Crew filter counts (always unfiltered so chips show totals)
  const crewCountsQuery = `
    SELECT "crewId" as id, "crewLabel" as label, COUNT(DISTINCT "callDate"::date)::int as count
    FROM "CallAttendance"
    GROUP BY "crewId", "crewLabel"
    ORDER BY count DESC
  `;

  const params = crewFilter.length ? crewFilter : [];

  const [callsRaw, countRaw, crewCounts] = await Promise.all([
    prisma.$queryRawUnsafe(callsQuery, ...params) as Promise<
      { crewId: string; crewLabel: string; callDate: Date; attendeeCount: number }[]
    >,
    prisma.$queryRawUnsafe(countQuery, ...params) as Promise<{ total: number }[]>,
    prisma.$queryRawUnsafe(crewCountsQuery) as Promise<
      { id: string; label: string; count: number }[]
    >,
  ]);

  const total = countRaw[0]?.total ?? 0;

  const calls = callsRaw.map((r) => ({
    date: r.callDate instanceof Date
      ? r.callDate.toISOString().split("T")[0]
      : String(r.callDate).split("T")[0],
    crewId: r.crewId,
    crewLabel: r.crewLabel,
    attendeeCount: r.attendeeCount,
  }));

  return NextResponse.json(
    {
      calls,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      filters: { crews: crewCounts },
    },
    {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" },
    }
  );
}
