import { parseGvizJson } from "@/app/lib/gviz-parser";
import { findColumnIndex } from "@/app/lib/sheet-utils";
import type { GvizCell, GvizResponse } from "@/app/lib/types/gviz";

/**
 * Shared helper for fetching the full list of public members from the
 * Google Sheets `Crew` tab.
 *
 * Privacy: this helper uses an ALLOW-LIST approach — only the fields in
 * `PublicMember` are extracted from the sheet. Discord ID, email, telegram,
 * wallet, phone and any other columns the sheet gains in the future are
 * never read.
 */

const SHEET_ID = "16BBOfasVwz8L6fPMungz_Y0EfF6Z9puskLAix3tCHzM";
const TAB_NAME = "Crew";
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export interface PublicMember {
  id: string;
  name: string;
  city: string;
  crews: string[];
  turtles: string[];
  orgs: string;
  skills: string;
  status: string;
}

export interface FetchMembersOptions {
  includeUnonboarded?: boolean;
  forceRefresh?: boolean;
}

type CacheEntry = {
  time: number;
  data: PublicMember[];
};

const CACHE = new Map<string, CacheEntry>();

function gvizUrl(sheetId: string, tabName?: string): string {
  const url = new URL(
    `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq`
  );
  url.searchParams.set("tqx", "out:json");
  if (tabName) url.searchParams.set("sheet", tabName);
  url.searchParams.set("headers", "0");
  return url.toString();
}

function cellString(cell: GvizCell | undefined): string {
  if (!cell) return "";
  const v = cell.v;
  const f = cell.f;
  if (v === null || v === undefined) {
    return typeof f === "string" ? f.trim() : "";
  }
  if (typeof v === "number" || typeof v === "boolean") {
    return String(v).trim();
  }
  return String(v).trim();
}

function splitList(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[,/|]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const UNONBOARDED_STATUSES = new Set(["", "unclaimed", "prospect", "invited"]);

function isOnboarded(
  status: string,
  crews: string[],
  turtles: string[]
): boolean {
  const normalized = status.trim().toLowerCase();
  const statusLooksUnclaimed = UNONBOARDED_STATUSES.has(normalized);
  if (!statusLooksUnclaimed) return true;
  // fall back: if they have a crew or turtle, count them
  return crews.length > 0 || turtles.length > 0;
}

/**
 * Fetch and parse the entire public member list.
 *
 * Results are cached for 5 minutes in-memory, keyed on the
 * `includeUnonboarded` flag. Pass `forceRefresh: true` to bypass.
 */
export async function fetchAllMembers(
  opts: FetchMembersOptions = {}
): Promise<PublicMember[]> {
  const includeUnonboarded = !!opts.includeUnonboarded;
  const cacheKey = includeUnonboarded ? "all" : "onboarded";

  if (!opts.forceRefresh) {
    const cached = CACHE.get(cacheKey);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
      return cached.data;
    }
  }

  const res = await fetch(gvizUrl(SHEET_ID, TAB_NAME), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to fetch Crew sheet: ${res.status}`);
  }
  const text = await res.text();
  const gviz: GvizResponse = parseGvizJson(text);
  const rows = gviz?.table?.rows || [];

  // Find header row
  let headerRowIdx = -1;
  let headerRowVals: string[] = [];

  for (let ri = 0; ri < Math.min(rows.length, 100); ri++) {
    const rowCells = rows[ri]?.c || [];
    const rowVals = rowCells.map((c: GvizCell) =>
      cellString(c).toLowerCase()
    );
    const hasName = rowVals.includes("name");
    const hasStatus =
      rowVals.includes("status") || rowVals.includes("frequency");
    const hasCity = rowVals.includes("city") || rowVals.includes("crews");

    if (hasName && (hasStatus || hasCity)) {
      headerRowIdx = ri;
      headerRowVals = rowCells.map((c: GvizCell) => cellString(c));
      break;
    }
  }

  if (headerRowIdx === -1) {
    throw new Error("Could not find header row in Crew sheet");
  }

  // Column indices (allow-list: only what PublicMember needs)
  const idColIdx =
    findColumnIndex(headerRowVals, ["id", "crew id", "member id"], 0) ?? 0;
  const nameColIdx = findColumnIndex(headerRowVals, ["name", "mafia name"]);
  const cityColIdx = findColumnIndex(headerRowVals, ["city"]);
  const statusColIdx = findColumnIndex(headerRowVals, [
    "status",
    "frequency",
  ]);
  const crewsColIdx = findColumnIndex(headerRowVals, ["crews", "crew"]);
  const turtlesColIdx = findColumnIndex(headerRowVals, ["turtles", "turtle"]);
  const orgsColIdx = findColumnIndex(headerRowVals, [
    "orgs",
    "affiliation",
    "org",
  ]);
  const skillsColIdx = findColumnIndex(headerRowVals, [
    "skills",
    "specialties",
    "specialty",
  ]);

  if (nameColIdx === null) {
    throw new Error("Could not find required Name column in Crew sheet");
  }

  const dataStartIdx = headerRowIdx + 1;
  const members: PublicMember[] = [];

  for (let ri = dataStartIdx; ri < rows.length; ri++) {
    const cells = rows[ri]?.c || [];

    const name = cellString(cells[nameColIdx]);
    if (!name) continue;

    const id = cellString(cells[idColIdx]);
    if (!id) continue;

    const city = cityColIdx !== null ? cellString(cells[cityColIdx]) : "";
    const status =
      statusColIdx !== null ? cellString(cells[statusColIdx]) : "";
    const crewsRaw =
      crewsColIdx !== null ? cellString(cells[crewsColIdx]) : "";
    const turtlesRaw =
      turtlesColIdx !== null ? cellString(cells[turtlesColIdx]) : "";
    const orgs = orgsColIdx !== null ? cellString(cells[orgsColIdx]) : "";
    const skills =
      skillsColIdx !== null ? cellString(cells[skillsColIdx]) : "";

    const crews = splitList(crewsRaw);
    const turtles = splitList(turtlesRaw);

    if (!includeUnonboarded && !isOnboarded(status, crews, turtles)) {
      continue;
    }

    members.push({
      id,
      name,
      city,
      crews,
      turtles,
      orgs,
      skills,
      status,
    });
  }

  CACHE.set(cacheKey, { time: Date.now(), data: members });
  return members;
}

/** Exposed for tests. */
export function __clearMembersCache(): void {
  CACHE.clear();
}
