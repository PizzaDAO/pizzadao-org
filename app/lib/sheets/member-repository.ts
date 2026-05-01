import { parseGvizJson } from '../gviz-parser';
import { findColumnIndex } from '../sheet-utils';
import { GvizResponse, GvizCell } from '../types/gviz';

const SHEET_ID = "16BBOfasVwz8L6fPMungz_Y0EfF6Z9puskLAix3tCHzM";
const TAB_NAME = "Crew";

export interface MemberSheetData {
  [key: string]: string | number | boolean | undefined;
  discordId?: string;
}

// Cache the full parsed sheet data
interface SheetCache {
  rows: MemberSheetData[];               // All member rows with header-keyed data
  discordToMember: Map<string, string>;  // discordId -> memberId
  memberToIdx: Map<string, number>;      // memberId -> index in rows[]
  timestamp: number;
}

let sheetCache: SheetCache | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch and cache the full Crew sheet data.
 * Returns the cached result if still fresh (5 min TTL).
 */
export async function getSheetData(): Promise<SheetCache> {
  if (sheetCache && Date.now() - sheetCache.timestamp < CACHE_TTL) {
    return sheetCache;
  }

  // Fetch and parse the full sheet once
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?sheet=${encodeURIComponent(TAB_NAME)}&tqx=out:json&headers=0`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);

  const text = await res.text();
  const gviz: GvizResponse = parseGvizJson(text);
  const rawRows = gviz?.table?.rows || [];

  // Find header row
  let headerRowIdx = -1;
  let headerVals: string[] = [];
  for (let ri = 0; ri < Math.min(rawRows.length, 100); ri++) {
    const rowCells = rawRows[ri]?.c || [];
    const rowVals = rowCells.map((c: GvizCell) => String(c?.v || c?.f || "").trim().toLowerCase());
    if (rowVals.includes("name") && (rowVals.includes("status") || rowVals.includes("frequency") || rowVals.includes("city") || rowVals.includes("crews"))) {
      headerRowIdx = ri;
      headerVals = rowCells.map((c: GvizCell) => String(c?.v || c?.f || "").trim());
      break;
    }
  }
  if (headerRowIdx === -1) throw new Error("Header row not found");

  const idxId = findColumnIndex(headerVals, ["id", "member id", "memberid"], 0) ?? 0;
  const idxDiscord = findColumnIndex(headerVals, ["discordid", "discord id", "discord"]);

  // Build full parsed rows + lookup maps
  const rows: MemberSheetData[] = [];
  const discordToMember = new Map<string, string>();
  const memberToIdx = new Map<string, number>();

  for (let ri = headerRowIdx + 1; ri < rawRows.length; ri++) {
    const cells = rawRows[ri]?.c || [];
    const memberId = String(cells[idxId]?.v ?? cells[idxId]?.f ?? "").trim();
    if (!memberId) continue;

    const discordId = idxDiscord != null
      ? String(cells[idxDiscord]?.v ?? cells[idxDiscord]?.f ?? "").trim()
      : "";

    const data: MemberSheetData = { discordId };
    headerVals.forEach((key, idx) => {
      if (key) data[key] = cells[idx]?.v ?? cells[idx]?.f;
    });

    const idx = rows.length;
    rows.push(data);
    memberToIdx.set(memberId, idx);
    if (discordId) discordToMember.set(discordId, memberId);
  }

  sheetCache = { rows, discordToMember, memberToIdx, timestamp: Date.now() };
  return sheetCache;
}

/**
 * Fetch member data from Google Sheets by member ID.
 * Uses the shared 5-min sheet cache.
 */
export async function fetchMemberById(memberId: string): Promise<MemberSheetData | null> {
  const cache = await getSheetData();
  const idx = cache.memberToIdx.get(memberId);
  if (idx === undefined) return null;
  return cache.rows[idx];
}

/**
 * Resolve a Discord ID to the corresponding member ID from the Crew sheet.
 * Uses the shared 5-min sheet cache.
 * Returns null if no matching row is found.
 */
export async function fetchMemberIdByDiscordId(discordId: string): Promise<string | null> {
  if (!discordId) return null;
  const cache = await getSheetData();
  return cache.discordToMember.get(discordId) ?? null;
}

/**
 * Look up a member's memberId and name from their Discord ID.
 * Uses the shared 5-min sheet cache.
 */
export async function fetchMemberByDiscordId(discordId: string): Promise<{ memberId: string; name: string } | null> {
  if (!discordId) return null;
  const cache = await getSheetData();
  const memberId = cache.discordToMember.get(discordId);
  if (!memberId) return null;
  const idx = cache.memberToIdx.get(memberId);
  if (idx === undefined) return null;
  const row = cache.rows[idx];
  const name = String(row["Name"] || row["Mafia Name"] || "").trim();
  return { memberId, name };
}
