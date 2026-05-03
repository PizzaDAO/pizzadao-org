/**
 * Crew Roster Audit — compares claimed crew membership (Google Sheet)
 * against actual attendance data (AttendanceSummary table).
 *
 * Produces three lists:
 * - missing: attended 3+ calls but not on roster
 * - inactive: on roster but 0 attendance or last attended >6 months ago
 * - healthy: on roster and attending
 */

import { prisma } from "@/app/lib/db";
import { fetchAllMembers, InternalMember } from "@/app/lib/sheets/members-list";

const MIN_CALLS_FOR_SUGGESTION = 3;
const INACTIVE_MONTHS = 6;

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
}

interface CrewBreakdownEntry {
  crewLabel: string;
  count: number;
  lastAttended?: string | null;
}

export async function runRosterAudit(): Promise<RosterAuditResult> {
  // 1. Fetch all members with Discord IDs
  const members = await fetchAllMembers({ includeDiscordId: true, includeUnonboarded: true });

  // 2. Fetch all AttendanceSummary rows
  const summaries = await prisma.attendanceSummary.findMany();

  // Build discordId → crewBreakdown map
  const attendanceByDiscordId = new Map<string, Record<string, CrewBreakdownEntry>>();
  for (const s of summaries) {
    if (s.discordId.startsWith("UNRESOLVED:")) continue;
    const breakdown = s.crewBreakdown as Record<string, CrewBreakdownEntry> | null;
    if (breakdown) {
      attendanceByDiscordId.set(s.discordId, breakdown);
    }
  }

  // Also build memberId → attendance for members matched via memberId
  const attendanceByMemberId = new Map<string, Record<string, CrewBreakdownEntry>>();
  for (const s of summaries) {
    if (s.discordId.startsWith("UNRESOLVED:")) continue;
    if (s.memberId) {
      const breakdown = s.crewBreakdown as Record<string, CrewBreakdownEntry> | null;
      if (breakdown) {
        attendanceByMemberId.set(s.memberId, breakdown);
      }
    }
  }

  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - INACTIVE_MONTHS);
  const cutoffStr = cutoffDate.toISOString();

  const missing: RosterMismatch[] = [];
  const inactive: RosterMismatch[] = [];
  let healthyCount = 0;

  for (const member of members as InternalMember[]) {
    const discordId = member.discordId;
    if (!discordId) continue;

    // Get attendance breakdown for this member
    const breakdown = attendanceByDiscordId.get(discordId)
      || attendanceByMemberId.get(member.id)
      || {};

    const claimedCrews = new Set(member.crews.map(c => c.toLowerCase().replace(/\s+/g, "_")));
    const attendedCrews = new Set(Object.keys(breakdown));

    // Check each claimed crew — is the member active?
    for (const crewId of claimedCrews) {
      if (crewId === "community_call" || crewId === "community") continue;

      const entry = breakdown[crewId];
      if (!entry || entry.count === 0) {
        // On roster but never attended (or 0 count)
        inactive.push({
          memberId: member.id,
          name: member.name,
          crewId,
          crewLabel: entry?.crewLabel || crewId,
          attendanceCount: 0,
          lastAttendedDate: null,
        });
      } else if (entry.lastAttended && entry.lastAttended < cutoffStr) {
        // On roster but last attended >6 months ago
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
      if (entry && entry.count >= MIN_CALLS_FOR_SUGGESTION) {
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

  // Sort: most attended first for missing, alphabetical for inactive
  missing.sort((a, b) => b.attendanceCount - a.attendanceCount);
  inactive.sort((a, b) => a.name.localeCompare(b.name));

  return { missing, inactive, healthyCount };
}
