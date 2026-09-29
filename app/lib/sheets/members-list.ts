import { findColumnIndex } from "@/app/lib/sheet-utils";
import type { GvizCell } from "@/app/lib/types/gviz";
import { getMembersSheet, type MembersTable } from "@/app/lib/sheets/member-repository";

/**
 * Shared helper for fetching the full list of public members from the
 * Google Sheets `Crew` tab.
 *
 * Privacy: this helper uses an ALLOW-LIST approach — only the fields in
 * `PublicMember` are extracted from the sheet. Discord ID, email, telegram,
 * wallet, phone and any other columns the sheet gains in the future are
 * never read.
 *
 * The sheet is read through the members repository (Next data cache, tag
 * "members"); the derived lists are memoized per parsed table.
 */

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

export interface InternalMember extends PublicMember {
  discordId: string;
}

export interface FetchMembersOptions {
  includeUnonboarded?: boolean;
  includeDiscordId?: boolean;
  forceRefresh?: boolean;
}

// Derived member lists keyed by option flags, per parsed members table. The
// table object is replaced whenever the sheet content changes, so this can
// never outlive the underlying data.
const DERIVED = new WeakMap<MembersTable, Map<string, (PublicMember | InternalMember)[]>>();

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
 * The sheet comes from the members repository's data cache (tag "members").
 * Pass `forceRefresh: true` to bypass it.
 */
export async function fetchAllMembers(
  opts: FetchMembersOptions & { includeDiscordId: true }
): Promise<InternalMember[]>;
export async function fetchAllMembers(
  opts?: FetchMembersOptions
): Promise<PublicMember[]>;
export async function fetchAllMembers(
  opts: FetchMembersOptions = {}
): Promise<PublicMember[] | InternalMember[]> {
  const includeUnonboarded = !!opts.includeUnonboarded;
  const includeDiscordId = !!opts.includeDiscordId;
  const cacheKey =
    (includeUnonboarded ? "all" : "onboarded") +
    (includeDiscordId ? "_with_discord" : "");

  let table: MembersTable;
  try {
    table = await getMembersSheet({ fresh: !!opts.forceRefresh });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      msg === "Header row not found"
        ? "Could not find header row in Crew sheet"
        : `Failed to fetch Crew sheet: ${msg}`
    );
  }

  let derived = DERIVED.get(table);
  if (!derived) {
    derived = new Map();
    DERIVED.set(table, derived);
  }
  const memoized = derived.get(cacheKey);
  if (memoized) return memoized;

  const rows = table.rows;
  const headerRowVals = table.headers;

  // Column indices (allow-list: only what PublicMember needs + optional discordId)
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
  const discordIdColIdx = includeDiscordId
    ? findColumnIndex(headerRowVals, ["discordid", "discord id", "discord"])
    : null;

  if (nameColIdx === null) {
    throw new Error("Could not find required Name column in Crew sheet");
  }

  const members: (PublicMember | InternalMember)[] = [];

  for (let ri = 0; ri < rows.length; ri++) {
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

    const member: PublicMember = {
      id,
      name,
      city,
      crews,
      turtles,
      orgs,
      skills,
      status,
    };

    if (includeDiscordId && discordIdColIdx !== null) {
      const discordId = cellString(cells[discordIdColIdx]);
      (member as InternalMember).discordId = discordId;
    } else if (includeDiscordId) {
      (member as InternalMember).discordId = "";
    }

    members.push(member);
  }

  derived.set(cacheKey, members);
  return members;
}
