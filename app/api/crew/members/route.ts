import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/app/lib/errors/error-response";
import {
  fetchAllMembers,
  type PublicMember,
  type InternalMember,
} from "@/app/lib/sheets/members-list";
import { getBatchAttendanceSummary } from "@/app/lib/attendance";
import { CREWS, TURTLES } from "@/app/ui/constants";

export const runtime = "nodejs";

interface CrewFilterCount {
  id: string;
  label: string;
  count: number;
}

interface TurtleFilterCount {
  id: string;
  count: number;
}

type MemberWithAttendance = PublicMember & {
  totalCalls: number;
  lastCallDate: string | null;
};

const VALID_SORTS = new Set(["name_asc", "name_desc", "most_calls", "recent_call"]);

interface MembersResponse {
  members: MemberWithAttendance[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  filters: {
    crews: CrewFilterCount[];
    turtles: TurtleFilterCount[];
  };
}

function parseIntParam(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return fallback;
  return n;
}

function matchesArrayIgnoreCase(
  values: string[],
  target: string
): boolean {
  const t = target.trim().toLowerCase();
  if (!t) return true;
  return values.some((v) => v.trim().toLowerCase() === t);
}

export const GET = withErrorHandling(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);

  const page = parseIntParam(searchParams.get("page"), 1);
  const rawLimit = parseIntParam(searchParams.get("limit"), 24);
  const limit = Math.min(Math.max(rawLimit, 1), 60);
  const search = (searchParams.get("search") || "").trim();
  const crewFilter = (searchParams.get("crew") || "").trim();
  const turtleFilter = (searchParams.get("turtle") || "").trim();
  const includeAll = searchParams.get("all") === "1";
  const sortParam = searchParams.get("sort") || "name_asc";
  const sort = VALID_SORTS.has(sortParam) ? sortParam : "name_asc";

  const allMembers = await fetchAllMembers({
    includeUnonboarded: includeAll,
    includeDiscordId: true,
  });

  // Apply filters in order: turtle → crew → search
  let filtered: InternalMember[] = allMembers;

  if (turtleFilter) {
    filtered = filtered.filter((m) =>
      matchesArrayIgnoreCase(m.turtles, turtleFilter)
    );
  }

  if (crewFilter) {
    filtered = filtered.filter((m) =>
      matchesArrayIgnoreCase(m.crews, crewFilter)
    );
  }

  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter((m) => {
      return (
        m.name.toLowerCase().includes(q) ||
        m.city.toLowerCase().includes(q) ||
        m.orgs.toLowerCase().includes(q) ||
        m.skills.toLowerCase().includes(q)
      );
    });
  }

  // Merge attendance data
  const attendanceMap = await getBatchAttendanceSummary();
  const enriched: MemberWithAttendance[] = filtered.map((m) => {
    const att = m.discordId ? attendanceMap.get(m.discordId) : undefined;
    // Strip discordId — only return public fields + attendance
    const { discordId: _discordId, ...publicFields } = m;
    return {
      ...publicFields,
      totalCalls: att?.totalCalls ?? 0,
      lastCallDate: att?.lastCallDate ?? null,
    };
  });

  // Sort
  switch (sort) {
    case "name_desc":
      enriched.sort((a, b) => b.name.localeCompare(a.name));
      break;
    case "most_calls":
      enriched.sort(
        (a, b) =>
          b.totalCalls - a.totalCalls || a.name.localeCompare(b.name)
      );
      break;
    case "recent_call":
      enriched.sort((a, b) => {
        // nulls last
        if (!a.lastCallDate && !b.lastCallDate)
          return a.name.localeCompare(b.name);
        if (!a.lastCallDate) return 1;
        if (!b.lastCallDate) return -1;
        const cmp = b.lastCallDate.localeCompare(a.lastCallDate);
        return cmp !== 0 ? cmp : a.name.localeCompare(b.name);
      });
      break;
    default: // name_asc
      enriched.sort((a, b) => a.name.localeCompare(b.name));
      break;
  }

  const total = enriched.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * limit;
  const pageSlice = enriched.slice(start, start + limit);

  // Per-crew and per-turtle counts from the UNFILTERED result (v1 simple)
  const crewCounts = CREWS.map((c) => ({
    id: c.id,
    label: c.label,
    count: allMembers.reduce(
      (acc, m) => (matchesArrayIgnoreCase(m.crews, c.id) ? acc + 1 : acc),
      0
    ),
  }));

  const turtleCounts = TURTLES.map((t) => ({
    id: t.id,
    count: allMembers.reduce(
      (acc, m) => (matchesArrayIgnoreCase(m.turtles, t.id) ? acc + 1 : acc),
      0
    ),
  }));

  const body: MembersResponse = {
    members: pageSlice,
    pagination: {
      page: safePage,
      limit,
      total,
      totalPages,
    },
    filters: {
      crews: crewCounts,
      turtles: turtleCounts,
    },
  };

  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=7200' }
  });
});
