// Mafia Points calculation service
// Computes reputation points from Discord roles, NFTs, POAPs, and call attendance

import { prisma } from "@/app/lib/db";
import { fetchGuildMember } from "@/app/lib/discord";
import { fetchPizzaDAONFTs } from "@/app/lib/nft";
import { fetchFilteredPOAPs } from "@/app/lib/poap";
import { fetchMemberById } from "@/app/lib/sheets/member-repository";
import { cacheGetOrSet } from "@/app/api/lib/cache";
import {
  MAFIA_POINT_SOURCES,
  REGIONAL_CREW_IDS,
  COMMUNITY_CREW_IDS,
  type PointSource,
  getRankForPoints,
} from "./config";

const CACHE_TTL_MEMBER = 15 * 60; // 15 minutes

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PointBreakdown {
  sourceId: string;
  label: string;
  category: string;
  points: number; // per unit
  quantity: number; // how many (1 for roles, N for NFTs/calls)
  total: number; // points × quantity
}

interface MafiaPointsResult {
  memberId: string;
  memberName: string;
  totalPoints: number;
  breakdown: PointBreakdown[];
  lastCalculated: number;
}

export interface MafiaRankResult {
  memberId: string;
  memberName: string;
  rank: { name: string; minPoints: number };
  lastCalculated: number;
}

// ---------------------------------------------------------------------------
// Core calculation
// ---------------------------------------------------------------------------

async function calculateMafiaPoints(
  memberId: string,
): Promise<MafiaPointsResult> {
  // Fetch member data from crew sheet to get discordId + wallet
  const member = await fetchMemberById(memberId);

  if (!member) {
    return {
      memberId,
      memberName: "Unknown",
      totalPoints: 0,
      breakdown: [],
      lastCalculated: Date.now(),
    };
  }

  const memberName = String(member["Name"] || member["name"] || "Unknown");
  const discordId = String(member["discordId"] || member["DiscordID"] || member["Discord ID"] || "");
  const wallet = findWallet(member);

  const breakdown: PointBreakdown[] = [];

  // --- Discord Roles ---
  if (discordId) {
    const guildMember = await fetchGuildMember(discordId);
    const userRoles = guildMember?.roles ?? [];

    for (const source of MAFIA_POINT_SOURCES.filter(
      (s) => s.category === "discord_role",
    )) {
      if (source.roleId && userRoles.includes(source.roleId)) {
        breakdown.push({
          sourceId: source.id,
          label: source.label,
          category: source.category,
          points: source.points,
          quantity: 1,
          total: source.points,
        });
      } else if (source.roleIds) {
        // "any of these roles" — count how many the user has
        const count = source.roleIds.filter((r) => userRoles.includes(r)).length;
        if (count > 0) {
          breakdown.push({
            sourceId: source.id,
            label: source.label,
            category: source.category,
            points: source.points,
            quantity: count,
            total: source.points * count,
          });
        }
      }
    }

    // --- Call Attendance (split by crew/regional/community) ---
    const allAttendance = await prisma.callAttendance.findMany({
      where: { discordId },
      select: { crewId: true },
    });

    if (allAttendance.length > 0) {
      let crewCount = 0;
      let regionalCount = 0;
      let communityCount = 0;

      for (const a of allAttendance) {
        if (COMMUNITY_CREW_IDS.includes(a.crewId)) communityCount++;
        else if (REGIONAL_CREW_IDS.includes(a.crewId)) regionalCount++;
        else crewCount++;
      }

      const attendanceEntries: Array<{ id: string; count: number }> = [
        { id: "crew-call-attendance", count: crewCount },
        { id: "regional-call-attendance", count: regionalCount },
        { id: "community-call-attendance", count: communityCount },
      ];

      for (const entry of attendanceEntries) {
        if (entry.count > 0) {
          const source = MAFIA_POINT_SOURCES.find((s) => s.id === entry.id)!;
          breakdown.push({
            sourceId: source.id,
            label: source.label,
            category: source.category,
            points: source.points,
            quantity: entry.count,
            total: source.points * entry.count,
          });
        }
      }
    }
  }

  // --- NFTs (per-item) ---
  if (wallet) {
    const nftData = await fetchPizzaDAONFTs(wallet);
    if (nftData.nfts.length > 0) {
      const nftSources = MAFIA_POINT_SOURCES.filter(
        (s) => s.category === "nft",
      );

      // Count NFTs per source by matching contractName
      for (const source of nftSources) {
        const count = countNFTsForSource(nftData.nfts, source);
        if (count > 0) {
          breakdown.push({
            sourceId: source.id,
            label: source.label,
            category: source.category,
            points: source.points,
            quantity: count,
            total: source.points * count,
          });
        }
      }
    }

    // --- POAPs ---
    try {
      const poapData = await fetchFilteredPOAPs(wallet);
      if (poapData.totalCount > 0) {
        const poapSource = MAFIA_POINT_SOURCES.find(
          (s) => s.id === "pizzadao-poap",
        )!;
        breakdown.push({
          sourceId: poapSource.id,
          label: poapSource.label,
          category: poapSource.category,
          points: poapSource.points,
          quantity: poapData.totalCount,
          total: poapSource.points * poapData.totalCount,
        });
      }
    } catch {
      // POAP fetch can fail — don't break the whole calculation
    }
  }

  // Sort by total descending
  breakdown.sort((a, b) => b.total - a.total);

  const totalPoints = breakdown.reduce((sum, b) => sum + b.total, 0);

  return {
    memberId,
    memberName,
    totalPoints,
    breakdown,
    lastCalculated: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Cached accessor
// ---------------------------------------------------------------------------

async function getMafiaPoints(
  memberId: string,
): Promise<MafiaPointsResult> {
  const cacheKey = `mafia-points:${memberId}`;
  return cacheGetOrSet(
    cacheKey,
    () => calculateMafiaPoints(memberId),
    CACHE_TTL_MEMBER,
  );
}

/**
 * Public API — returns only the rank tier, not points.
 */
export async function getMafiaRank(
  memberId: string,
): Promise<MafiaRankResult> {
  const result = await getMafiaPoints(memberId);
  const rank = getRankForPoints(result.totalPoints);
  return {
    memberId: result.memberId,
    memberName: result.memberName,
    rank: { name: rank.name, minPoints: rank.minPoints },
    lastCalculated: result.lastCalculated,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findWallet(member: Record<string, unknown>): string | null {
  for (const key of Object.keys(member)) {
    if (key.toLowerCase().includes("wallet") || key.toLowerCase().includes("address")) {
      const val = String(member[key] || "").trim();
      if (val.startsWith("0x") && val.length >= 42) return val;
    }
  }
  return null;
}

/**
 * Count NFTs matching a source by contract name (case-insensitive partial match).
 */
function countNFTsForSource(
  nfts: Array<{ contractName: string }>,
  source: PointSource,
): number {
  if (!source.contractName) return 0;
  const needle = source.contractName.toLowerCase();
  return nfts.filter((n) =>
    n.contractName.toLowerCase().includes(needle),
  ).length;
}
