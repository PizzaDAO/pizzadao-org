/**
 * Crew Roster Audit Script (Phase 1)
 *
 * Compares claimed crew membership (Google Sheet) against actual attendance
 * data (AttendanceSummary table). Outputs a report of mismatches.
 *
 * Usage:
 *   DOTENV_CONFIG_PATH=.env.migration node scripts/audit-crew-rosters.mjs
 */

import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";

dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || ".env.migration" });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set. Use DOTENV_CONFIG_PATH=.env.migration");
  process.exit(1);
}

const sql = neon(DATABASE_URL);

const SHEET_ID = "16BBOfasVwz8L6fPMungz_Y0EfF6Z9puskLAix3tCHzM";
const TAB_NAME = "Crew";
const MIN_CALLS = 3;
const INACTIVE_MONTHS = 6;

async function fetchMembers() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(TAB_NAME)}&headers=0`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sheet fetch failed: ${res.status}`);
  const text = await res.text();

  // Parse GViz JSON (strip prefix/suffix)
  const jsonStr = text.replace(/^[^(]*\(/, "").replace(/\);?\s*$/, "");
  const gviz = JSON.parse(jsonStr);
  const rows = gviz?.table?.rows || [];

  // Find header row
  let headerIdx = -1;
  let headers = [];
  for (let i = 0; i < Math.min(rows.length, 50); i++) {
    const cells = rows[i]?.c || [];
    const vals = cells.map(c => String(c?.v ?? c?.f ?? "").trim().toLowerCase());
    if (vals.includes("name") && (vals.includes("crews") || vals.includes("crew"))) {
      headerIdx = i;
      headers = vals;
      break;
    }
  }

  if (headerIdx === -1) throw new Error("Header row not found");

  const idCol = headers.findIndex(h => h === "id" || h === "crew id" || h === "member id");
  const nameCol = headers.findIndex(h => h === "name" || h === "mafia name");
  const crewsCol = headers.findIndex(h => h === "crews" || h === "crew");
  const discordCol = headers.findIndex(h => h === "discordid" || h === "discord id" || h === "discord");

  const members = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const cells = rows[i]?.c || [];
    const id = String(cells[idCol]?.v ?? cells[idCol]?.f ?? "").trim();
    const name = String(cells[nameCol]?.v ?? cells[nameCol]?.f ?? "").trim();
    const crewsRaw = String(cells[crewsCol]?.v ?? cells[crewsCol]?.f ?? "").trim();
    const discordId = discordCol >= 0 ? String(cells[discordCol]?.v ?? cells[discordCol]?.f ?? "").trim() : "";

    if (!id || !name) continue;

    const crews = crewsRaw
      .split(/[,/|]+/)
      .map(s => s.trim())
      .filter(Boolean);

    members.push({ id, name, crews, discordId });
  }

  return members;
}

async function fetchAttendanceSummaries() {
  const rows = await sql`SELECT "discordId", "memberId", "crewBreakdown" FROM "AttendanceSummary"`;
  return rows;
}

async function main() {
  console.log("Fetching members from sheet...");
  const members = await fetchMembers();
  console.log(`  Found ${members.length} members`);

  console.log("Fetching attendance summaries...");
  const summaries = await fetchAttendanceSummaries();
  console.log(`  Found ${summaries.length} summaries`);

  // Build lookup maps
  const byDiscordId = new Map();
  const byMemberId = new Map();
  for (const s of summaries) {
    if (s.discordId.startsWith("UNRESOLVED:")) continue;
    if (s.crewBreakdown) {
      byDiscordId.set(s.discordId, s.crewBreakdown);
      if (s.memberId) byMemberId.set(s.memberId, s.crewBreakdown);
    }
  }

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - INACTIVE_MONTHS);
  const cutoffStr = cutoff.toISOString();

  const missing = [];
  const inactive = [];
  let healthyCount = 0;

  for (const member of members) {
    if (!member.discordId) continue;

    const breakdown = byDiscordId.get(member.discordId) || byMemberId.get(member.id) || {};
    const claimedCrews = new Set(member.crews.map(c => c.toLowerCase().replace(/\s+/g, "_")));
    const attendedCrews = new Set(Object.keys(breakdown));

    // Check claimed crews
    for (const crewId of claimedCrews) {
      if (crewId === "community_call" || crewId === "community") continue;
      const entry = breakdown[crewId];

      if (!entry || entry.count === 0) {
        inactive.push({
          memberId: member.id,
          name: member.name,
          crewId,
          crewLabel: entry?.crewLabel || crewId,
          attendanceCount: 0,
          lastAttendedDate: null,
        });
      } else if (entry.lastAttended && entry.lastAttended < cutoffStr) {
        inactive.push({
          memberId: member.id,
          name: member.name,
          crewId,
          crewLabel: entry.crewLabel,
          attendanceCount: entry.count,
          lastAttendedDate: entry.lastAttended,
        });
      } else {
        healthyCount++;
      }
    }

    // Check attended crews not on roster
    for (const crewId of attendedCrews) {
      if (crewId === "community_call" || crewId === "community") continue;
      if (claimedCrews.has(crewId)) continue;
      const entry = breakdown[crewId];
      if (entry && entry.count >= MIN_CALLS) {
        missing.push({
          memberId: member.id,
          name: member.name,
          crewId,
          crewLabel: entry.crewLabel,
          attendanceCount: entry.count,
          lastAttendedDate: entry.lastAttended || null,
        });
      }
    }
  }

  // Sort
  missing.sort((a, b) => b.attendanceCount - a.attendanceCount);
  inactive.sort((a, b) => a.name.localeCompare(b.name));

  // Output report
  console.log("\n" + "=".repeat(70));
  console.log("CREW ROSTER AUDIT REPORT");
  console.log("=".repeat(70));

  console.log(`\nHealthy (on roster + actively attending): ${healthyCount}`);

  console.log(`\n${"─".repeat(70)}`);
  console.log(`MISSING FROM ROSTER (attended ${MIN_CALLS}+ calls, not listed) — ${missing.length} entries`);
  console.log("─".repeat(70));
  if (missing.length === 0) {
    console.log("  (none)");
  } else {
    console.log(
      "  " + "Member".padEnd(25) + "Crew".padEnd(15) + "Calls".padEnd(8) + "Last Attended"
    );
    for (const m of missing) {
      console.log(
        "  " +
        `${m.name} (#${m.memberId})`.padEnd(25) +
        m.crewLabel.padEnd(15) +
        String(m.attendanceCount).padEnd(8) +
        (m.lastAttendedDate ? new Date(m.lastAttendedDate).toLocaleDateString() : "—")
      );
    }
  }

  console.log(`\n${"─".repeat(70)}`);
  console.log(`INACTIVE ON ROSTER (listed but 0 calls or >${INACTIVE_MONTHS}mo ago) — ${inactive.length} entries`);
  console.log("─".repeat(70));
  if (inactive.length === 0) {
    console.log("  (none)");
  } else {
    console.log(
      "  " + "Member".padEnd(25) + "Crew".padEnd(15) + "Calls".padEnd(8) + "Last Attended"
    );
    for (const m of inactive) {
      console.log(
        "  " +
        `${m.name} (#${m.memberId})`.padEnd(25) +
        m.crewLabel.padEnd(15) +
        String(m.attendanceCount).padEnd(8) +
        (m.lastAttendedDate ? new Date(m.lastAttendedDate).toLocaleDateString() : "Never")
      );
    }
  }

  console.log(`\n${"─".repeat(70)}`);
  console.log("SUMMARY");
  console.log("─".repeat(70));
  console.log(`  Healthy:  ${healthyCount}`);
  console.log(`  Missing:  ${missing.length} (should be added to roster)`);
  console.log(`  Inactive: ${inactive.length} (should be removed or flagged)`);
  console.log();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
