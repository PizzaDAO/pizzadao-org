// NFT Leaderboard API - Aggregates NFT holdings by collection across all members
import { NextResponse } from "next/server";
import { getNFTContracts, ALCHEMY_CHAIN_URLS } from "@/app/lib/nft-config";
import { NFTContract } from "@/app/lib/nft-types";
import { cacheGet, cacheSet } from "../../lib/cache";
import { getAllMemberWallets } from "@/app/lib/wallet-lookup";
import {
  cellText,
  getMembersSheet,
  memberIdColumn,
  membersColumn,
  type MembersTable,
} from "@/app/lib/sheets/member-repository";

export const runtime = "nodejs";

const CACHE_KEY = "nft-leaderboard:v1";
const CACHE_TTL = 3600; // 1 hour in seconds

const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;

interface MemberInfo {
  memberId: string;
  name: string;
  wallet: string;
  turtles: string[];
}

interface HolderInfo {
  memberId: string;
  memberName: string;
  nftCount: number;
  turtles: string[];
}

interface CollectionLeaderboard {
  contractAddress: string;
  contractName: string;
  chain: string;
  description?: string;
  order?: number;
  holders: HolderInfo[];
  totalHolders: number;
  totalNFTs: number;
}

interface LeaderboardResponse {
  collections: CollectionLeaderboard[];
  lastUpdated: number;
  cached: boolean;
  memberCount?: number;
  error?: string;
}


/**
 * Fetch member names and turtles from the Crew sheet.
 * Returns a map of memberId -> { name, turtles }.
 */
async function fetchMemberDetails(): Promise<
  Map<string, { name: string; turtles: string[] }>
> {
  // Served from the members data cache (tag "members").
  let sheet: MembersTable;
  try {
    sheet = await getMembersSheet();
  } catch {
    return new Map();
  }

  // Find column indices
  const idxId = memberIdColumn(sheet);
  const idxName = membersColumn(sheet, ["name"]);
  const idxTurtles = membersColumn(sheet, ["turtles", "roles"]);

  const details = new Map<string, { name: string; turtles: string[] }>();

  for (const row of sheet.rows) {
    const cells = row?.c || [];
    const id = cellText(cells[idxId]);
    const name = idxName != null ? cellText(cells[idxName]) : "";
    const turtlesRaw = idxTurtles != null ? String(cells[idxTurtles]?.v ?? cells[idxTurtles]?.f ?? "") : "";

    if (id) {
      const turtles = turtlesRaw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      details.set(id, { name: name || `Member ${id}`, turtles });
    }
  }

  return details;
}

/**
 * Fetch NFT count for a wallet from a specific contract
 */
async function fetchNFTCount(
  wallet: string,
  contract: NFTContract
): Promise<number> {
  if (!ALCHEMY_API_KEY) return 0;

  const baseUrl = ALCHEMY_CHAIN_URLS[contract.chain];
  if (!baseUrl) return 0;

  try {
    const url = `${baseUrl}/${ALCHEMY_API_KEY}/getNFTsForOwner?owner=${wallet}&contractAddresses[]=${contract.address}&withMetadata=false`;
    const res = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    if (!res.ok) return 0;

    const data = await res.json();
    return data.totalCount || data.ownedNfts?.length || 0;
  } catch {
    return 0;
  }
}

/**
 * Aggregate NFT holdings across all members with concurrency limit
 */
async function aggregateLeaderboard(): Promise<LeaderboardResponse> {
  // Fetch wallets from DB (or sheet fallback) and member details in parallel
  const [walletEntries, memberDetails, contracts] = await Promise.all([
    getAllMemberWallets(),
    fetchMemberDetails(),
    getNFTContracts(),
  ]);

  // Group wallets by memberId so we can aggregate across all wallets
  const walletsByMember = new Map<string, string[]>();
  for (const w of walletEntries) {
    if (!w.walletAddress.startsWith("0x") || w.walletAddress.length < 42) continue;
    const existing = walletsByMember.get(w.memberId) || [];
    existing.push(w.walletAddress.toLowerCase());
    walletsByMember.set(w.memberId, existing);
  }

  // Build MemberInfo array (one entry per member, first wallet as representative)
  const members: MemberInfo[] = [];
  for (const [memberId, wallets] of walletsByMember) {
    const details = memberDetails.get(memberId);
    members.push({
      memberId,
      name: details?.name || `Member ${memberId}`,
      wallet: wallets[0], // representative wallet for display
      turtles: details?.turtles || [],
    });
  }

  if (members.length === 0) {
    return {
      collections: [],
      lastUpdated: Date.now(),
      cached: false,
      memberCount: 0,
      error: "No members with wallets found",
    };
  }

  // Map: contractAddress -> Map<memberId, {info, count}>
  const collectionHolders: Map<
    string,
    Map<string, { info: MemberInfo; count: number }>
  > = new Map();

  // Initialize collection maps
  for (const contract of contracts) {
    collectionHolders.set(contract.address.toLowerCase(), new Map());
  }

  // Process members with concurrency limit (5 at a time)
  // For each member, fetch NFT counts across ALL their wallets and sum
  const CONCURRENCY = 5;
  const memberQueue = [...members];
  let processed = 0;

  async function processMember(member: MemberInfo) {
    const memberWallets = walletsByMember.get(member.memberId) || [member.wallet];
    for (const contract of contracts) {
      // Sum NFT counts across all wallets for this member
      let totalCount = 0;
      for (const wallet of memberWallets) {
        totalCount += await fetchNFTCount(wallet, contract);
      }
      if (totalCount > 0) {
        const holders = collectionHolders.get(contract.address.toLowerCase());
        if (holders) {
          holders.set(member.memberId, { info: member, count: totalCount });
        }
      }
    }
    processed++;
    if (processed % 10 === 0) {
    }
  }

  // Process in batches
  while (memberQueue.length > 0) {
    const batch = memberQueue.splice(0, CONCURRENCY);
    await Promise.all(batch.map(processMember));
  }

  // Build response
  const collections: CollectionLeaderboard[] = [];

  for (const contract of contracts) {
    const holders = collectionHolders.get(contract.address.toLowerCase());
    if (!holders || holders.size === 0) continue;

    // Sort by NFT count descending
    const sortedHolders = Array.from(holders.values())
      .sort((a, b) => b.count - a.count)
      .map(({ info, count }) => ({
        memberId: info.memberId,
        memberName: info.name,
        nftCount: count,
        turtles: info.turtles,
      }));

    const totalNFTs = sortedHolders.reduce((sum, h) => sum + h.nftCount, 0);

    collections.push({
      contractAddress: contract.address,
      contractName: contract.name,
      chain: contract.chain,
      description: contract.description,
      order: contract.order,
      holders: sortedHolders,
      totalHolders: sortedHolders.length,
      totalNFTs,
    });
  }

  // Sort collections by order, then by name
  collections.sort((a, b) => {
    if (a.order !== undefined && b.order !== undefined) {
      return a.order - b.order;
    }
    if (a.order !== undefined) return -1;
    if (b.order !== undefined) return 1;
    return a.contractName.localeCompare(b.contractName);
  });

  return {
    collections,
    lastUpdated: Date.now(),
    cached: false,
    memberCount: members.length,
  };
}

export async function GET() {
  try {
    // Check cache first
    const cached = await cacheGet<LeaderboardResponse>(CACHE_KEY);
    const cacheHeaders = { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' };

    if (cached) {
      return NextResponse.json({ ...cached, cached: true }, { headers: cacheHeaders });
    }

    // Aggregate fresh data
    const data = await aggregateLeaderboard();

    // Cache the result
    await cacheSet(CACHE_KEY, data, CACHE_TTL);

    return NextResponse.json(data, { headers: cacheHeaders });
  } catch (error) {
    console.error("[nfts/leaderboard]", error);
    return NextResponse.json(
      {
        collections: [],
        lastUpdated: Date.now(),
        cached: false,
        error: "Failed to load NFT leaderboard",
      },
      { status: 500 }
    );
  }
}
