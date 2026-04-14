/**
 * Standalone script to run the initial attendance sync.
 * Reads crew Attendance tabs via Google Sheets API,
 * reads daily sheets via GViz API, inserts into Neon DB.
 *
 * Usage: node scripts/sync-attendance.mjs
 * Requires: .env with DATABASE_URL and GOOGLE_SERVICE_ACCOUNT_JSON
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("dotenv").config({ path: ".env" });

import { google } from "googleapis";
import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL in .env");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

// Google Sheets API setup — dotenv loads multiline values with literal newlines
const saRaw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
if (!saRaw) {
  console.error("Missing GOOGLE_SERVICE_ACCOUNT_JSON in .env");
  process.exit(1);
}

// dotenv loads the multiline JSON with real newlines.
// JSON.parse can handle them fine EXCEPT inside string values (like private_key).
// Strategy: replace newlines only within string values (between quotes on the same key).
// Simplest: just replace real newlines with spaces, except inside private_key where they must be \n
let saFixed = saRaw;
// First, protect the private key content by converting its newlines to a placeholder
saFixed = saFixed.replace(
  /(-----BEGIN PRIVATE KEY-----)([\s\S]*?)(-----END PRIVATE KEY-----)/,
  (_, begin, middle, end) => begin + middle.replace(/\n/g, "%%NL%%") + "\\n" + end
);
// Now replace remaining real newlines with nothing (they're just JSON formatting whitespace)
// Actually just remove them isn't right either. Let's take a different approach.
// Parse it by stripping newlines inside string values only.
// Simplest correct approach: the value from dotenv IS valid JSON if we handle it right.
// The issue is ONLY the private_key field has literal newlines inside a JSON string.
// So: find the private_key value and escape its newlines.
const credentials = JSON.parse(
  saRaw.replace(
    /("private_key"\s*:\s*")([\s\S]*?)(")/,
    (_, prefix, key, suffix) => prefix + key.replace(/\n/g, "\\n") + suffix
  )
);
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});
const sheets = google.sheets({ version: "v4", auth });

// Crew sheets to sync
const COMMUNITY_CALL = {
  sheetId: "1S7WGjHpMcxw8erA3cBevoGlVX_G253AMGg1kNAU_53o",
  crewId: "community_call",
  crewLabel: "Community Call",
};

// All crew sheet IDs (from crew-mappings sheet)
const KNOWN_CREWS = [
  { sheetId: "1YVUJHWlyivugIWERa2qsaNGTQDN7Ogu1lIhATO8c6kU", crewId: "ops", crewLabel: "Ops" },
  { sheetId: "1AVTWcd6Vij1Hi6n_K-f84-lL1BHwfKXUot-boAz--k4", crewId: "events", crewLabel: "Events" },
  { sheetId: "1PGb50v1wu3QVEyft5IR6wF_qnO8KRboeLghp48cbuEg", crewId: "tech", crewLabel: "Tech" },
  { sheetId: "1W5ESCefvjc7QxV_yrRoibfKIuQTtVZy9nnozx-RYIng", crewId: "creative", crewLabel: "Creative" },
  { sheetId: "1UyKrGby4W8R1cQ5ZIq3lj5eZBVfNaqM-7M0ZwNw4hmk", crewId: "biz_dev", crewLabel: "Biz Dev" },
  { sheetId: "1L8HzfeO73rU9v53gk12pvZSzbGSrt0g3-l6kkCia2bQ", crewId: "education", crewLabel: "Education" },
  { sheetId: "1TGemZCKSBAC2-ENVHgkrRkQ0xf3pdsgy0u7MOq-IwW4", crewId: "comms", crewLabel: "Comms" },
  { sheetId: "1seUqpUEXU1EDN2o43-08u1qfm1xad-8v_1X_kSw_mS8", crewId: "latam", crewLabel: "LATAM" },
  { sheetId: "1U_v8GXHPPUPoQ01mGaUico1wiq6FCZdeNvqPDHW_8cg", crewId: "africa", crewLabel: "Africa" },
  { sheetId: "1byTD0DkdQmnnKvmvlnEY-gLaSnWAEzuUUkbzoSZpR3Q", crewId: "music", crewLabel: "Music" },
];

function extractSheetId(url) {
  const m = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

function parseGvizText(text) {
  // Strip the google.visualization.Query.setResponse(...) wrapper
  const match = text.match(/google\.visualization\.Query\.setResponse\((.+)\);?\s*$/s);
  const json = match ? match[1] : text;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function getCellValue(cell) {
  if (!cell) return "";
  return String(cell.f ?? cell.v ?? "").trim();
}

/**
 * Convert a Google Sheets serial date number to a JS Date.
 * Google Sheets epoch: day 1 = January 1, 1900 (with the Lotus 1-2-3 bug).
 * Serial 1 = 1900-01-01, but due to the bug, day 60 = 1900-02-29 (doesn't exist).
 * In practice: serial - 25569 = Unix days.
 */
function serialToDate(serial) {
  const num = Number(serial);
  if (isNaN(num) || num < 1 || num > 100000) return null;
  // Google Sheets epoch offset: 25569 days between 1899-12-30 and 1970-01-01
  const ms = (num - 25569) * 86400000;
  return new Date(ms);
}

function parseDate(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  // Try as serial number first (pure digits, possibly with decimal)
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return serialToDate(trimmed);
  }
  // Try as date string
  const d = new Date(trimmed);
  if (!isNaN(d.getTime()) && d.getFullYear() > 1990 && d.getFullYear() < 2100) return d;
  return null;
}

async function readAttendanceTab(crewSheetId) {
  const entries = [];
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: crewSheetId,
      range: "'Attendance'",
      valueRenderOption: "FORMULA",
      dateTimeRenderOption: "FORMATTED_STRING",
    });
    const rows = res.data.values || [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 2) continue;
      const dateStr = String(row[0] ?? "").trim();
      const linkCell = String(row[1] ?? "").trim();
      const date = parseDate(dateStr);
      if (!date) continue;

      let sheetUrl = null;
      const formulaMatch = linkCell.match(/=\s*HYPERLINK\s*\(\s*"([^"]+)"/i);
      if (formulaMatch) sheetUrl = formulaMatch[1];
      if (!sheetUrl && linkCell.startsWith("http")) sheetUrl = linkCell;
      if (!sheetUrl) continue;

      const dailySheetId = extractSheetId(sheetUrl);
      if (!dailySheetId) continue;
      entries.push({ date, dailySheetId });
    }
  } catch (err) {
    const msg = err.message || String(err);
    if (msg.includes("Unable to parse range") || msg.includes("not found")) {
      // No Attendance tab
    } else {
      console.error(`  Error reading Attendance tab for ${crewSheetId}: ${msg}`);
    }
  }
  return entries;
}

async function fetchDailySheet(dailySheetId) {
  const url = `https://docs.google.com/spreadsheets/d/${dailySheetId}/gviz/tq?tqx=out:json&headers=1`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`GViz fetch failed: ${res.status}`);
  const text = await res.text();
  if (text.toLowerCase().includes("<html") || text.toLowerCase().includes("<!doctype")) {
    throw new Error("Sheet returned HTML — may be deleted or unshared");
  }
  const gviz = parseGvizText(text);
  const allRows = gviz?.table?.rows || [];
  if (allRows.length === 0) return [];

  // GViz headers=1 doesn't always work — the first row may be column headers.
  // Detect by checking if first row has header-like text (no Discord IDs).
  let dataRows = allRows;
  let headerRow = null;
  const firstRowVals = (allRows[0].c || []).map((c) => getCellValue(c).toLowerCase());
  const looksLikeHeader = firstRowVals.some(
    (v) => v.includes("discord") || v.includes("name") || v.includes("timestamp")
  );
  if (looksLikeHeader) {
    headerRow = firstRowVals;
    dataRows = allRows.slice(1);
  }

  // Find Discord ID column: scan for the column with the most 17-20 digit values
  const numCols = Math.max(...dataRows.map((r) => (r.c || []).length), 0);
  let discordIdCol = -1;
  let displayNameCol = -1;
  let maxDiscordIds = 0;

  for (let col = 0; col < numCols; col++) {
    let count = 0;
    for (const row of dataRows) {
      const v = getCellValue((row.c || [])[col]);
      if (/^\d{17,20}$/.test(v)) count++;
    }
    if (count > maxDiscordIds) {
      maxDiscordIds = count;
      discordIdCol = col;
    }
  }

  if (discordIdCol < 0) return []; // no column with Discord IDs

  // Find display name column from headers, or use col adjacent to Discord ID
  if (headerRow) {
    const nameIdx = headerRow.findIndex(
      (v) => (v.includes("name") || v.includes("display")) && !v.includes("discord")
    );
    if (nameIdx >= 0) displayNameCol = nameIdx;
  }
  if (displayNameCol < 0) {
    // Default: column right after Discord ID, or left if Discord ID is last
    displayNameCol = discordIdCol === 0 ? 1 : discordIdCol - 1;
  }

  const attendees = [];
  const seen = new Set();
  for (const row of dataRows) {
    const cells = row.c || [];
    const displayName = getCellValue(cells[displayNameCol]);
    const discordId = getCellValue(cells[discordIdCol]);
    if (!discordId || !/^\d{17,20}$/.test(discordId)) continue;
    if (seen.has(discordId)) continue;
    seen.add(discordId);
    attendees.push({ discordId, displayName });
  }
  return attendees;
}

async function getAlreadySynced() {
  const rows = await sql`SELECT "dailySheetId" FROM "AttendanceSyncLog"`;
  return new Set(rows.map((r) => r.dailySheetId));
}

async function syncCrew(crew, syncedSet) {
  console.log(`\nSyncing ${crew.crewLabel}...`);
  const entries = await readAttendanceTab(crew.sheetId);
  console.log(`  Found ${entries.length} attendance entries`);

  const newEntries = entries.filter((e) => !syncedSet.has(e.dailySheetId));
  console.log(`  ${newEntries.length} new (not yet synced)`);

  if (newEntries.length === 0) return { newCalls: 0, newRecords: 0 };

  let totalCalls = 0;
  let totalRecords = 0;

  // Process in batches of 3
  for (let i = 0; i < newEntries.length; i += 3) {
    const batch = newEntries.slice(i, i + 3);
    const results = await Promise.allSettled(
      batch.map(async (entry) => {
        try {
          const attendees = await fetchDailySheet(entry.dailySheetId);
          return { entry, attendees };
        } catch (err) {
          console.error(`  Failed to fetch ${entry.dailySheetId}: ${err.message}`);
          return null;
        }
      })
    );

    for (const result of results) {
      if (result.status !== "fulfilled" || !result.value) {
        console.log(`  [skip] Promise status=${result.status}`);
        continue;
      }
      const { entry, attendees } = result.value;
      if (attendees.length === 0) {
        console.log(`  [skip] ${entry.dailySheetId} — 0 attendees (date=${entry.date.toISOString().slice(0,10)})`);
        continue;
      }

      // Insert attendance records
      for (const a of attendees) {
        try {
          await sql`
            INSERT INTO "CallAttendance" ("discordId", "displayName", "crewId", "crewLabel", "callDate", "dailySheetId", "createdAt")
            VALUES (${a.discordId}, ${a.displayName || null}, ${crew.crewId}, ${crew.crewLabel}, ${entry.date.toISOString()}, ${entry.dailySheetId}, NOW())
            ON CONFLICT ("discordId", "dailySheetId") DO NOTHING
          `;
          totalRecords++;
        } catch (err) {
          // Skip dupes silently
        }
      }

      // Log the sync
      try {
        await sql`
          INSERT INTO "AttendanceSyncLog" ("crewSheetId", "crewId", "dailySheetId", "callDate", "attendeeCount", "syncedAt")
          VALUES (${crew.sheetId}, ${crew.crewId}, ${entry.dailySheetId}, ${entry.date.toISOString()}, ${attendees.length}, NOW())
          ON CONFLICT ("dailySheetId") DO NOTHING
        `;
      } catch (err) {
        // Skip dupes
      }

      syncedSet.add(entry.dailySheetId);
      totalCalls++;
      console.log(`  ✓ ${entry.date.toISOString().slice(0, 10)} — ${attendees.length} attendees`);
    }
  }

  return { newCalls: totalCalls, newRecords: totalRecords };
}

async function main() {
  console.log("=== Attendance Sync ===\n");

  const syncedSet = await getAlreadySynced();
  console.log(`Already synced: ${syncedSet.size} daily sheets`);

  const allCrews = [COMMUNITY_CALL, ...KNOWN_CREWS];
  let totalCalls = 0;
  let totalRecords = 0;

  for (const crew of allCrews) {
    try {
      const result = await syncCrew(crew, syncedSet);
      totalCalls += result.newCalls;
      totalRecords += result.newRecords;
    } catch (err) {
      console.error(`  Error syncing ${crew.crewLabel}: ${err.message}`);
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`New calls synced: ${totalCalls}`);
  console.log(`New attendance records: ${totalRecords}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
