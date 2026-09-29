/**
 * The single read path for the members sheet (SHEET_IDS.members, "Crew" tab).
 *
 * Caching
 * -------
 * Reads go through Next's data cache: `fetch` with
 * `next: { revalidate: MEMBERS_REVALIDATE_SECONDS, tags: [MEMBERS_CACHE_TAG] }`,
 * so every serverless instance shares one cached copy of the sheet, and member
 * writes call `invalidateMembersCache()` (revalidateTag) to expire it at once.
 *
 * `{ fresh: true }` bypasses the cache (`cache: "no-store"`). Use it ONLY where
 * a stale row could make a read-then-write unsafe: ownership checks before an
 * edit, "already claimed?" checks before a claim, the current crew list before
 * join/leave, and new-member ID availability. Everything else should read
 * through the cache.
 *
 * Parsing is memoized on the response body (see `parseMemo`): when the data
 * cache hands back the same bytes, the previously parsed table is reused. That
 * memo can never serve data older than the data cache itself.
 */

import { revalidateTag } from "next/cache";
import { findHeaderRowIndex } from "../gviz-parser";
import { findColumnIndex } from "../sheet-utils";
import type { GvizCell, GvizRow, GvizTable } from "../types/gviz";
import { SHEET_IDS, SHEET_TABS } from "./config";
import { fetchGvizText } from "./gviz";
import { parseGvizJson } from "../gviz-parser";

/** Cache tag for every members-sheet read. */
export const MEMBERS_CACHE_TAG = "members";
/** Data-cache lifetime for members-sheet reads, in seconds. */
export const MEMBERS_REVALIDATE_SECONDS = 120;

export interface MemberReadOptions {
  /**
   * Bypass the data cache. Only for read-then-write safety checks; see the
   * module comment.
   */
  fresh?: boolean;
}

export interface MemberSheetData {
  [key: string]: string | number | boolean | undefined;
  discordId?: string;
}

/** The parsed members sheet. Treat as read-only: instances are shared. */
export interface MembersTable {
  /** Every row GViz returned (requested with headers=0, so the header row is included). */
  allRows: GvizRow[];
  /** Index of the header row in `allRows`, or -1 if it could not be found. */
  headerRowIndex: number;
  /** Trimmed header cell text (blank headers are ""). Empty if no header row. */
  headers: string[];
  /** Data rows (everything after the header row). Empty if no header row. */
  rows: GvizRow[];
}

// Cache the full parsed sheet data
interface SheetCache {
  rows: MemberSheetData[];               // All member rows with header-keyed data
  discordToMember: Map<string, string>;  // discordId -> memberId
  memberToIdx: Map<string, number>;      // memberId -> index in rows[]
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Cell / column helpers (shared by routes that read the members sheet)
// ---------------------------------------------------------------------------

/** Cell value as trimmed text, preferring the raw value (`v`) over the formatted one (`f`). */
export function cellText(cell: GvizCell | null | undefined): string {
  return String(cell?.v ?? cell?.f ?? "").trim();
}

/** Raw cell value (`v`, else `f`) as stored in header-keyed member records. */
export function cellRaw(cell: GvizCell | null | undefined): string | number | boolean | undefined {
  const v = cell?.v ?? cell?.f;
  return v === null ? undefined : v;
}

/** Header text as the legacy header-row detection read it. */
function headerText(cell: GvizCell | null | undefined): string {
  return String(cell?.v || cell?.f || "").trim();
}

/**
 * The members header row has a "Name" column plus a Status/Frequency or
 * City/Crews column.
 */
export function isMembersHeaderRow(normalizedValues: string[]): boolean {
  const has = (v: string) => normalizedValues.includes(v);
  return has("name") && (has("status") || has("frequency") || has("city") || has("crews"));
}

/** Column aliases for the members sheet. */
export const MEMBER_COLUMNS = {
  id: ["id", "crewid", "memberid"],
  discordId: ["discordid", "discord", "discorduserid"],
  name: ["name", "mafia name"],
  city: ["city"],
  status: ["status", "frequency"],
  crews: ["crews", "crew"],
  turtles: ["turtles", "turtle", "roles"],
  orgs: ["orgs", "affiliation", "org"],
  skills: ["skills", "specialties", "specialty"],
  wallet: ["wallet", "wallet address", "eth address", "address"],
} as const;

/** Index of a column by alias (see `findColumnIndex`), or null. */
export function membersColumn(table: MembersTable, aliases: readonly string[]): number | null {
  return findColumnIndex(table.headers, [...aliases]);
}

/** Index of the member-ID column; falls back to column A (the ID column has no header). */
export function memberIdColumn(table: MembersTable): number {
  return findColumnIndex(table.headers, [...MEMBER_COLUMNS.id], 0) ?? 0;
}

/**
 * Find a member's data row.
 *
 * - `"numeric"` (default): compare as integers, so "7", 7 and "007" all match
 *   row 7. Used by routes that take the ID from a URL.
 * - `"exact"`: compare the trimmed cell text to `memberId`.
 */
export function findMemberRow(
  table: MembersTable,
  memberId: string | number,
  match: "numeric" | "exact" = "numeric",
): GvizRow | null {
  const idCol = memberIdColumn(table);
  if (match === "exact") {
    const target = String(memberId).trim();
    if (!target) return null;
    return table.rows.find((r) => cellText(r?.c?.[idCol]) === target) ?? null;
  }
  const target = parseInt(String(memberId), 10);
  if (Number.isNaN(target)) return null;
  return (
    table.rows.find((r) => {
      const val = r?.c?.[idCol]?.v;
      if (typeof val === "number") return val === target;
      if (typeof val === "string") return parseInt(val, 10) === target;
      return false;
    }) ?? null
  );
}

/** Header-keyed record for a row: `{ [header]: v ?? f }` for every non-blank header. */
export function rowToRecord(table: MembersTable, row: GvizRow): Record<string, string | number | boolean | undefined> {
  const data: Record<string, string | number | boolean | undefined> = {};
  table.headers.forEach((key, idx) => {
    if (key) data[key] = cellRaw(row?.c?.[idx]);
  });
  return data;
}

// ---------------------------------------------------------------------------
// Fetch + parse
// ---------------------------------------------------------------------------

let parseMemo: { body: string; table: MembersTable } | null = null;
const indexMemo = new WeakMap<MembersTable, SheetCache>();

function parseMembersTable(body: string): MembersTable {
  const gviz = parseGvizJson(body);
  const table: GvizTable = gviz?.table ?? {};
  const allRows = table.rows || [];
  const headerRowIndex = findHeaderRowIndex(table, isMembersHeaderRow, 100);
  if (headerRowIndex === -1) {
    return { allRows, headerRowIndex, headers: [], rows: [] };
  }
  return {
    allRows,
    headerRowIndex,
    headers: (allRows[headerRowIndex]?.c || []).map(headerText),
    rows: allRows.slice(headerRowIndex + 1),
  };
}

/**
 * Fetch and parse the members sheet. `headerRowIndex` is -1 when the header
 * row cannot be found; most callers want `getMembersSheet`, which throws then.
 */
export async function getMembersTable(opts: MemberReadOptions = {}): Promise<MembersTable> {
  const body = await fetchGvizText(
    SHEET_IDS.members,
    { tab: SHEET_TABS.members, headers: 0 },
    opts.fresh
      ? { fresh: true }
      : { revalidate: MEMBERS_REVALIDATE_SECONDS, tags: [MEMBERS_CACHE_TAG] },
  );
  if (parseMemo && parseMemo.body === body) return parseMemo.table;
  const table = parseMembersTable(body);
  parseMemo = { body, table };
  return table;
}

/** Like `getMembersTable`, but throws when the header row is missing. */
export async function getMembersSheet(opts: MemberReadOptions = {}): Promise<MembersTable> {
  const table = await getMembersTable(opts);
  if (table.headerRowIndex === -1) throw new Error("Header row not found");
  return table;
}

function buildIndex(table: MembersTable): SheetCache {
  const idxId = memberIdColumn(table);
  const idxDiscord = findColumnIndex(table.headers, ["discordid", "discord id", "discord"]);

  const rows: MemberSheetData[] = [];
  const discordToMember = new Map<string, string>();
  const memberToIdx = new Map<string, number>();

  for (const raw of table.rows) {
    const cells = raw?.c || [];
    const memberId = cellText(cells[idxId]);
    if (!memberId) continue;

    const discordId = idxDiscord != null ? cellText(cells[idxDiscord]) : "";

    const data: MemberSheetData = { discordId, ...rowToRecord(table, raw) };

    const idx = rows.length;
    rows.push(data);
    memberToIdx.set(memberId, idx);
    if (discordId) discordToMember.set(discordId, memberId);
  }

  return { rows, discordToMember, memberToIdx, timestamp: Date.now() };
}

/**
 * The members sheet as header-keyed rows plus discordId/memberId lookup maps.
 */
export async function getSheetData(opts: MemberReadOptions = {}): Promise<SheetCache> {
  const table = await getMembersSheet(opts);
  let index = indexMemo.get(table);
  if (!index) {
    index = buildIndex(table);
    indexMemo.set(table, index);
  }
  return index;
}

/**
 * Fetch member data from Google Sheets by member ID (exact match on the ID cell).
 */
export async function fetchMemberById(
  memberId: string,
  opts: MemberReadOptions = {},
): Promise<MemberSheetData | null> {
  const cache = await getSheetData(opts);
  const idx = cache.memberToIdx.get(memberId);
  if (idx === undefined) return null;
  return cache.rows[idx];
}

/**
 * Resolve a Discord ID to the corresponding member ID from the Crew sheet.
 * Returns null if no matching row is found.
 */
export async function fetchMemberIdByDiscordId(
  discordId: string,
  opts: MemberReadOptions = {},
): Promise<string | null> {
  if (!discordId) return null;
  const cache = await getSheetData(opts);
  return cache.discordToMember.get(discordId) ?? null;
}

/**
 * Look up a member's memberId and name from their Discord ID.
 */
export async function fetchMemberByDiscordId(
  discordId: string,
  opts: MemberReadOptions = {},
): Promise<{ memberId: string; name: string } | null> {
  if (!discordId) return null;
  const cache = await getSheetData(opts);
  const memberId = cache.discordToMember.get(discordId);
  if (!memberId) return null;
  const idx = cache.memberToIdx.get(memberId);
  if (idx === undefined) return null;
  const row = cache.rows[idx];
  const name = String(row["Name"] || row["Mafia Name"] || "").trim();
  return { memberId, name };
}

// ---------------------------------------------------------------------------
// Invalidation
// ---------------------------------------------------------------------------

/**
 * Expire every cached members-sheet read. Call after any write to the members
 * sheet (profile updates, claims, crew joins, Discord role sync, skills/orgs).
 *
 * Note: GViz itself can lag a few seconds behind an Apps Script write, so a
 * read immediately after this may still see the old row; the next expiry
 * (MEMBERS_REVALIDATE_SECONDS) corrects it.
 */
export function invalidateMembersCache(): void {
  parseMemo = null;
  try {
    // `expire: 0` expires immediately (the "max" profile would serve stale data
    // once while revalidating in the background).
    revalidateTag(MEMBERS_CACHE_TAG, { expire: 0 });
  } catch {
    // Outside a Next request (unit tests, scripts): there is no data cache to expire.
  }
}

/** Test helper: forget the parse memo. */
export function __resetMembersParseMemo(): void {
  parseMemo = null;
}
