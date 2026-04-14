/**
 * Crew call attendance — sync from Google Sheets + query from DB
 *
 * Data flow:
 *   syncAllCrewAttendance()
 *     -> For each crew sheet, read "Attendance" tab via Google Sheets API (FORMULA mode)
 *     -> For each new daily sheet, read via GViz API (public, no auth)
 *     -> Insert CallAttendance + AttendanceSyncLog rows
 *
 *   getAttendanceForMember(discordId)
 *     -> Simple Prisma query against CallAttendance table
 */

import { prisma } from "@/app/lib/db";
import { sheetsClient } from "@/app/api/lib/google-sheets";
import { getCrewMappings } from "@/app/lib/crew-mappings";
import { parseGvizJson, getCellValue } from "@/app/lib/gviz-parser";
import promiseLimit from "promise-limit";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMMUNITY_CALL_SHEET_ID = "1S7WGjHpMcxw8erA3cBevoGlVX_G253AMGg1kNAU_53o";
const COMMUNITY_CALL_CREW_ID = "community_call";
const COMMUNITY_CALL_LABEL = "Community Call";

/** Max concurrent GViz fetches for daily sheets */
const CONCURRENT_GVIZ = 3;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DailySheetEntry {
  date: Date;
  dailySheetId: string;
}

interface Attendee {
  discordId: string;
  displayName: string;
}

export interface AttendanceResult {
  totalCalls: number;
  crewBreakdown: Record<
    string,
    { crewLabel: string; count: number; lastAttended?: string }
  >;
  recentCalls: { date: string; crew: string; crewId: string }[];
}

export interface SyncStats {
  newCalls: number;
  newRecords: number;
  crews: string[];
  errors: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractSheetId(url: string): string | null {
  const m = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

/**
 * Parse a date string from the Attendance tab (col A).
 * Common formats: "1/15/2025", "2025-01-15", "Jan 15, 2025"
 */
function parseDate(raw: string): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return null;
  return d;
}

// ---------------------------------------------------------------------------
// 1. Read Attendance tab via Google Sheets API (FORMULA mode)
// ---------------------------------------------------------------------------

/**
 * Read the "Attendance" tab of a crew spreadsheet.
 * Uses Google Sheets API with FORMULA valueRenderOption so we can
 * extract HYPERLINK formulas that point to daily sheets.
 *
 * Returns an array of { date, dailySheetId } entries.
 */
async function readAttendanceTab(
  crewSheetId: string
): Promise<DailySheetEntry[]> {
  const entries: DailySheetEntry[] = [];

  try {
    const res = await sheetsClient.spreadsheets.values.get({
      spreadsheetId: crewSheetId,
      range: "'Attendance'",
      valueRenderOption: "FORMULA",
      dateTimeRenderOption: "FORMATTED_STRING",
    });

    const rows = res.data.values || [];

    // Skip header row (row 0)
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 2) continue;

      const dateStr = String(row[0] ?? "").trim();
      const linkCell = String(row[1] ?? "").trim();

      // Parse date
      const date = parseDate(dateStr);
      if (!date) continue;

      // Extract daily sheet ID from HYPERLINK formula or plain URL
      let sheetUrl: string | null = null;

      // Try HYPERLINK formula: =HYPERLINK("url", "label")
      const formulaMatch = linkCell.match(
        /=\s*HYPERLINK\s*\(\s*"([^"]+)"/i
      );
      if (formulaMatch) {
        sheetUrl = formulaMatch[1];
      }

      // Fallback: plain URL
      if (!sheetUrl && linkCell.startsWith("http")) {
        sheetUrl = linkCell;
      }

      if (!sheetUrl) continue;

      const dailySheetId = extractSheetId(sheetUrl);
      if (!dailySheetId) continue;

      entries.push({ date, dailySheetId });
    }
  } catch (err: unknown) {
    // Sheet might not have an "Attendance" tab — that's OK
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes("Unable to parse range") ||
      msg.includes("not found")
    ) {
      // No Attendance tab — skip
    } else {
      console.error(
        `[attendance] Error reading Attendance tab for sheet ${crewSheetId}:`,
        msg
      );
    }
  }

  return entries;
}

// ---------------------------------------------------------------------------
// 2. Fetch a daily attendance sheet via GViz (public, no auth)
// ---------------------------------------------------------------------------

/**
 * Read one daily attendance sheet (public) using the GViz API.
 * Columns: A=Timestamp, B=Name, C=Discord User ID, D=Joined At, E=Left At, F=Notes
 */
async function fetchDailySheet(
  dailySheetId: string
): Promise<Attendee[]> {
  const url = `https://docs.google.com/spreadsheets/d/${dailySheetId}/gviz/tq?tqx=out:json&headers=1`;

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(
      `GViz fetch failed for ${dailySheetId}: ${res.status}`
    );
  }

  const text = await res.text();

  // Check for HTML error page (sheet may be deleted/unshared)
  if (
    text.toLowerCase().includes("<html") ||
    text.toLowerCase().includes("<!doctype")
  ) {
    throw new Error(
      `GViz returned HTML for ${dailySheetId} — sheet may be deleted or unshared`
    );
  }

  const gviz = parseGvizJson(text);
  const rows = gviz?.table?.rows || [];

  const attendees: Attendee[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const cells = row.c || [];
    // Column B (index 1) = display name
    // Column C (index 2) = Discord User ID
    const displayName = getCellValue(cells[1]).trim();
    const discordId = getCellValue(cells[2]).trim();

    // Discord IDs are 17-19 digit numeric strings
    if (!discordId || !/^\d{17,20}$/.test(discordId)) continue;

    // Deduplicate within the sheet (same person polled multiple times)
    if (seen.has(discordId)) continue;
    seen.add(discordId);

    attendees.push({ discordId, displayName });
  }

  return attendees;
}

// ---------------------------------------------------------------------------
// 3. Sync one crew
// ---------------------------------------------------------------------------

async function syncCrewAttendance(
  crewSheetId: string,
  crewId: string,
  crewLabel: string
): Promise<{ newCalls: number; newRecords: number }> {
  // 1. Read Attendance tab entries
  const entries = await readAttendanceTab(crewSheetId);
  if (entries.length === 0) {
    return { newCalls: 0, newRecords: 0 };
  }

  // 2. Check which daily sheets are already synced
  const alreadySynced = await prisma.attendanceSyncLog.findMany({
    where: {
      dailySheetId: { in: entries.map((e) => e.dailySheetId) },
    },
    select: { dailySheetId: true },
  });
  const syncedSet = new Set(alreadySynced.map((s) => s.dailySheetId));

  const newEntries = entries.filter((e) => !syncedSet.has(e.dailySheetId));
  if (newEntries.length === 0) {
    return { newCalls: 0, newRecords: 0 };
  }

  // 3. Fetch new daily sheets (throttled)
  const limit = promiseLimit<{
    entry: DailySheetEntry;
    attendees: Attendee[];
  } | null>(CONCURRENT_GVIZ);

  const results = await Promise.all(
    newEntries.map((entry) =>
      limit(async () => {
        try {
          const attendees = await fetchDailySheet(entry.dailySheetId);
          return { entry, attendees };
        } catch (err) {
          console.error(
            `[attendance] Failed to fetch daily sheet ${entry.dailySheetId}:`,
            err instanceof Error ? err.message : err
          );
          return null;
        }
      })
    )
  );

  // 4. Insert records
  let totalNewRecords = 0;
  let totalNewCalls = 0;

  for (const result of results) {
    if (!result) continue;
    const { entry, attendees } = result;

    if (attendees.length === 0) continue;

    // Bulk insert attendance records (skip duplicates via unique constraint)
    const created = await prisma.callAttendance.createMany({
      data: attendees.map((a) => ({
        discordId: a.discordId,
        displayName: a.displayName || null,
        crewId,
        crewLabel,
        callDate: entry.date,
        dailySheetId: entry.dailySheetId,
      })),
      skipDuplicates: true,
    });

    totalNewRecords += created.count;

    // Log the sync
    await prisma.attendanceSyncLog.create({
      data: {
        crewSheetId,
        crewId,
        dailySheetId: entry.dailySheetId,
        callDate: entry.date,
        attendeeCount: attendees.length,
      },
    });

    totalNewCalls++;
  }

  return { newCalls: totalNewCalls, newRecords: totalNewRecords };
}

// ---------------------------------------------------------------------------
// 4. Sync all crews
// ---------------------------------------------------------------------------

export async function syncAllCrewAttendance(): Promise<SyncStats> {
  const stats: SyncStats = {
    newCalls: 0,
    newRecords: 0,
    crews: [],
    errors: [],
  };

  // Build the list of crews to sync
  const crewsToSync: {
    sheetId: string;
    crewId: string;
    crewLabel: string;
  }[] = [];

  // Community Call (hardcoded)
  crewsToSync.push({
    sheetId: COMMUNITY_CALL_SHEET_ID,
    crewId: COMMUNITY_CALL_CREW_ID,
    crewLabel: COMMUNITY_CALL_LABEL,
  });

  // Crew mappings — dynamically discovered
  try {
    const { crews } = await getCrewMappings();
    for (const crew of crews) {
      if (!crew.sheet) continue;
      const sheetId = extractSheetId(crew.sheet);
      if (!sheetId) continue;
      crewsToSync.push({
        sheetId,
        crewId: crew.id,
        crewLabel: crew.label,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stats.errors.push(`Failed to load crew mappings: ${msg}`);
  }

  // Sync each crew sequentially (the daily sheet fetches within are throttled)
  for (const crew of crewsToSync) {
    try {
      const result = await syncCrewAttendance(
        crew.sheetId,
        crew.crewId,
        crew.crewLabel
      );
      stats.newCalls += result.newCalls;
      stats.newRecords += result.newRecords;
      if (result.newCalls > 0) {
        stats.crews.push(crew.crewLabel);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stats.errors.push(`${crew.crewLabel}: ${msg}`);
    }
  }

  return stats;
}

// ---------------------------------------------------------------------------
// 5. Query attendance for a member
// ---------------------------------------------------------------------------

export async function getAttendanceForMember(
  discordId: string
): Promise<AttendanceResult> {
  const records = await prisma.callAttendance.findMany({
    where: { discordId },
    orderBy: { callDate: "desc" },
  });

  // Aggregate per-crew breakdown
  const crewBreakdown: AttendanceResult["crewBreakdown"] = {};
  for (const r of records) {
    if (!crewBreakdown[r.crewId]) {
      crewBreakdown[r.crewId] = {
        crewLabel: r.crewLabel,
        count: 0,
      };
    }
    crewBreakdown[r.crewId].count++;
    // Track latest attendance per crew
    const dateStr = r.callDate.toISOString();
    if (!crewBreakdown[r.crewId].lastAttended || dateStr > crewBreakdown[r.crewId].lastAttended!) {
      crewBreakdown[r.crewId].lastAttended = dateStr;
    }
  }

  // Recent calls (last 10, deduplicated by date+crew)
  const seen = new Set<string>();
  const recentCalls: AttendanceResult["recentCalls"] = [];
  for (const r of records) {
    const key = `${r.callDate.toISOString()}|${r.crewId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recentCalls.push({
      date: r.callDate.toISOString(),
      crew: r.crewLabel,
      crewId: r.crewId,
    });
    if (recentCalls.length >= 10) break;
  }

  return {
    totalCalls: records.length,
    crewBreakdown,
    recentCalls,
  };
}
