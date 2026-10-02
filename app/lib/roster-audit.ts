/**
 * Crew Roster Audit — compares claimed crew membership (Google Sheet)
 * against actual attendance data (AttendanceSummary table).
 *
 * Produces three lists:
 * - missing: attended 3+ calls but not on roster
 * - inactive: on roster but 0 attendance or last attended >6 months ago
 * - healthy: on roster and attending
 *
 * The diff itself lives in the pure `computeRosterAudit` so it can be unit
 * tested without a database or the sheet.
 */

import { prisma } from "@/app/lib/db";
import { fetchAllMembers } from "@/app/lib/sheets/members-list";
import { normalizeCrewId, NON_ROSTER_CREW_IDS } from "@/app/lib/crew-id";

export const MIN_CALLS_FOR_SUGGESTION = 3;
export const INACTIVE_MONTHS = 6;

export interface RosterMismatch {
  memberId: string;
  name: string;
  crewId: string;
  crewLabel: string;
  attendanceCount: number;
  lastAttendedDate: string | null;
}

export interface RosterAuditResult {
  missing: RosterMismatch[];   // Attended but not on roster
  inactive: RosterMismatch[];  // On roster but not attending
  healthyCount: number;
  /**
   * Roster claims for crews that have no attendance tracking at all (no
   * member has ever been recorded attending them). These are NOT flagged as
   * inactive, since absence of data there says nothing about the member.
   */
  untrackedCount: number;
  /** Members skipped because their attendance data was unusable. */
  skippedMembers: number;
}

export interface AuditMember {
  id: string;
  name: string;
  crews: string[];
  discordId?: string;
}

export interface AuditSummary {
  discordId: string;
  memberId: string | null;
  crewBreakdown: unknown;
}

interface CrewBreakdownEntry {
  crewLabel: string;
  count: number;
  lastAttended: string | null;
}

type Breakdown = Record<string, CrewBreakdownEntry>;

/**
 * Validate a raw `crewBreakdown` JSON value. Returns null when the value is
 * not an object at all (malformed). Individual malformed entries are dropped.
 */
export function parseCrewBreakdown(raw: unknown): Breakdown | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Breakdown = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const crewId = normalizeCrewId(key);
    if (!crewId || !value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const count = typeof v.count === "number" ? v.count : Number.NaN;
    if (!Number.isFinite(count) || count < 0) continue;
    let lastAttended: string | null = null;
    if (typeof v.lastAttended === "string" && !Number.isNaN(Date.parse(v.lastAttended))) {
      lastAttended = new Date(v.lastAttended).toISOString();
    }
    const crewLabel =
      typeof v.crewLabel === "string" && v.crewLabel.trim() ? v.crewLabel.trim() : crewId;
    out[crewId] = { crewLabel, count, lastAttended };
  }
  return out;
}

/** Pure roster-vs-attendance diff. */
export function computeRosterAudit(
  members: AuditMember[],
  summaries: AuditSummary[],
  now: Date = new Date()
): RosterAuditResult {
  const byDiscordId = new Map<string, Breakdown | null>();
  const byMemberId = new Map<string, Breakdown | null>();
  const trackedCrewIds = new Set<string>();

  for (const s of summaries) {
    if (!s || typeof s.discordId !== "string") continue;
    if (s.discordId.startsWith("UNRESOLVED:")) continue;
    const breakdown = parseCrewBreakdown(s.crewBreakdown);
    if (breakdown) {
      for (const crewId of Object.keys(breakdown)) trackedCrewIds.add(crewId);
    }
    // Store null for malformed summaries so the member is skipped rather
    // than treated as "attended nothing" (which would flag every crew).
    byDiscordId.set(s.discordId, breakdown);
    if (s.memberId) byMemberId.set(String(s.memberId), breakdown);
  }

  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - INACTIVE_MONTHS);
  const cutoffMs = cutoff.getTime();

  const missing: RosterMismatch[] = [];
  const inactive: RosterMismatch[] = [];
  let healthyCount = 0;
  let untrackedCount = 0;
  let skippedMembers = 0;
  const seenMembers = new Set<string>();

  for (const member of members) {
    if (!member?.id || seenMembers.has(member.id)) continue;
    seenMembers.add(member.id);

    const discordId = (member.discordId ?? "").trim();
    let breakdown: Breakdown | null | undefined;
    if (discordId && byDiscordId.has(discordId)) {
      breakdown = byDiscordId.get(discordId);
    } else if (byMemberId.has(member.id)) {
      breakdown = byMemberId.get(member.id);
    } else if (discordId) {
      // Attendance is keyed by Discord ID, so no summary = no attendance.
      breakdown = {};
    } else {
      // No Discord ID and no memberId match: we cannot know attendance.
      continue;
    }
    if (breakdown === null || breakdown === undefined) {
      skippedMembers++;
      continue;
    }

    const claimedCrews = new Set(
      (Array.isArray(member.crews) ? member.crews : [])
        .map(normalizeCrewId)
        .filter(Boolean)
    );

    for (const crewId of claimedCrews) {
      if (NON_ROSTER_CREW_IDS.has(crewId)) continue;
      const entry = breakdown[crewId];

      if (!entry || entry.count === 0) {
        if (!trackedCrewIds.has(crewId)) {
          untrackedCount++;
          continue;
        }
        inactive.push({
          memberId: member.id,
          name: member.name,
          crewId,
          crewLabel: entry?.crewLabel || crewId,
          attendanceCount: 0,
          lastAttendedDate: null,
        });
      } else if (entry.lastAttended && Date.parse(entry.lastAttended) < cutoffMs) {
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

    for (const [crewId, entry] of Object.entries(breakdown)) {
      if (NON_ROSTER_CREW_IDS.has(crewId)) continue;
      if (claimedCrews.has(crewId)) continue;
      if (entry.count >= MIN_CALLS_FOR_SUGGESTION) {
        missing.push({
          memberId: member.id,
          name: member.name,
          crewId,
          crewLabel: entry.crewLabel,
          attendanceCount: entry.count,
          lastAttendedDate: entry.lastAttended,
        });
      }
    }
  }

  // Sort: most attended first for missing, alphabetical for inactive
  missing.sort((a, b) => b.attendanceCount - a.attendanceCount || a.name.localeCompare(b.name));
  inactive.sort((a, b) => a.name.localeCompare(b.name) || a.crewId.localeCompare(b.crewId));

  return { missing, inactive, healthyCount, untrackedCount, skippedMembers };
}

export async function runRosterAudit(): Promise<RosterAuditResult> {
  const members = await fetchAllMembers({ includeDiscordId: true, includeUnonboarded: true });
  const summaries = await prisma.attendanceSummary.findMany({
    select: { discordId: true, memberId: true, crewBreakdown: true },
  });
  return computeRosterAudit(members, summaries);
}
