import { NextRequest, NextResponse } from "next/server";
import { withErrorHandling } from "@/app/lib/errors/error-response";
import { fetchAllMembers, type PublicMember } from "@/app/lib/sheets/members-list";
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

interface MembersResponse {
  members: PublicMember[];
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

  const allMembers = await fetchAllMembers({
    includeUnonboarded: includeAll,
  });

  // Apply filters in order: turtle → crew → search
  let filtered = allMembers;

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

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * limit;
  const pageSlice = filtered.slice(start, start + limit);

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

  return NextResponse.json(body);
});
