import { parseGvizJson } from "@/app/lib/gviz-parser";
import { NextRequest, NextResponse } from "next/server";
import { TURTLES } from "@/app/ui/constants";

export const runtime = "nodejs";

const SHEET_ID = "16BBOfasVwz8L6fPMungz_Y0EfF6Z9puskLAix3tCHzM";
const TAB_NAME = "Crew";

// Cache for turtle members
const CACHE = new Map<string, { time: number; data: any }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function gvizUrl(sheetId: string, tabName?: string) {
  const url = new URL(
    `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq`
  );
  url.searchParams.set("tqx", "out:json");
  if (tabName) url.searchParams.set("sheet", tabName);
  url.searchParams.set("headers", "0");
  return url.toString();
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ turtleId: string }> }
) {
  try {
    const { turtleId } = await params;

    if (!turtleId) {
      return NextResponse.json(
        { error: "Missing turtle ID" },
        { status: 400 }
      );
    }

    // Validate that this is a known turtle
    const turtleDef = TURTLES.find(
      (t) => t.id.toLowerCase() === decodeURIComponent(turtleId).toLowerCase()
    );
    if (!turtleDef) {
      return NextResponse.json(
        { error: "Unknown turtle role" },
        { status: 404 }
      );
    }

    // Check cache
    const cacheKey = turtleDef.id.toLowerCase();
    const cached = CACHE.get(cacheKey);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
      return NextResponse.json(cached.data);
    }

    const url = gvizUrl(SHEET_ID, TAB_NAME);
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to fetch sheet");
    const text = await res.text();
    const gviz = parseGvizJson(text);
    const rows = gviz?.table?.rows || [];

    // Find header row
    let headerRowIdx = -1;
    let headerRowVals: string[] = [];

    for (let ri = 0; ri < Math.min(rows.length, 100); ri++) {
      const rowCells = rows[ri]?.c || [];
      const rowVals = rowCells.map((c: any) =>
        String(c?.v || c?.f || "")
          .trim()
          .toLowerCase()
      );

      const hasName = rowVals.includes("name");
      const hasTurtles =
        rowVals.includes("turtles") || rowVals.includes("turtle");

      if (hasName && hasTurtles) {
        headerRowIdx = ri;
        headerRowVals = rowCells.map((c: any) =>
          String(c?.v || c?.f || "").trim()
        );
        break;
      }
    }

    if (headerRowIdx === -1) {
      throw new Error("Could not find header row");
    }

    // Find column indices
    const normalizedHeaders = headerRowVals.map((h) =>
      h.toLowerCase().replace(/[#\s\-_]+/g, "")
    );

    const idColIdx = (() => {
      const idAliases = ["id", "crewid", "memberid"];
      for (let i = 0; i < normalizedHeaders.length; i++) {
        if (idAliases.includes(normalizedHeaders[i])) return i;
      }
      return 0;
    })();

    const nameColIdx = normalizedHeaders.indexOf("name");
    const turtlesColIdx = normalizedHeaders.includes("turtles")
      ? normalizedHeaders.indexOf("turtles")
      : normalizedHeaders.indexOf("turtle");
    const cityColIdx = normalizedHeaders.indexOf("city");
    const statusColIdx = normalizedHeaders.includes("status")
      ? normalizedHeaders.indexOf("status")
      : normalizedHeaders.indexOf("frequency");

    if (nameColIdx === -1 || turtlesColIdx === -1) {
      throw new Error("Could not find required columns");
    }

    // Filter members who have this turtle role
    const dataStartIdx = headerRowIdx + 1;
    const members: Array<{
      id: string;
      name: string;
      city: string;
      status: string;
      turtles: string;
    }> = [];

    const targetTurtle = turtleDef.id.toLowerCase();

    for (let ri = dataStartIdx; ri < rows.length; ri++) {
      const cells = rows[ri]?.c || [];

      const name = String(cells[nameColIdx]?.v ?? cells[nameColIdx]?.f ?? "").trim();
      if (!name) continue;

      const turtlesRaw = String(
        cells[turtlesColIdx]?.v ?? cells[turtlesColIdx]?.f ?? ""
      ).trim();
      if (!turtlesRaw) continue;

      // Split turtles and check if this member has the target turtle
      const memberTurtles = turtlesRaw
        .split(/[,/|]+/)
        .map((t: string) => t.trim())
        .filter(Boolean);

      const hasTurtle = memberTurtles.some(
        (t: string) => t.toLowerCase() === targetTurtle
      );

      if (!hasTurtle) continue;

      const id = String(cells[idColIdx]?.v ?? cells[idColIdx]?.f ?? "").trim();
      const city =
        cityColIdx >= 0
          ? String(cells[cityColIdx]?.v ?? cells[cityColIdx]?.f ?? "").trim()
          : "";
      const status =
        statusColIdx >= 0
          ? String(
              cells[statusColIdx]?.v ?? cells[statusColIdx]?.f ?? ""
            ).trim()
          : "";

      members.push({
        id,
        name,
        city,
        status,
        turtles: turtlesRaw,
      });
    }

    const result = {
      turtle: {
        id: turtleDef.id,
        label: turtleDef.label,
        role: turtleDef.role,
        image: turtleDef.image,
      },
      members,
      count: members.length,
    };

    // Cache the result
    CACHE.set(cacheKey, { time: Date.now(), data: result });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error("Failed to load turtle members:", error);
    return NextResponse.json(
      { error: "Failed to load turtle members" },
      { status: 500 }
    );
  }
}
