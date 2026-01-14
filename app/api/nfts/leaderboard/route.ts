// NFT Leaderboard API - Aggregates NFT holdings by collection across all members
import { NextResponse } from "next/server";
import { getNFTContracts, ALCHEMY_CHAIN_URLS } from "@/app/lib/nft-config";
import { NFTContract } from "@/app/lib/nft-types";
import { cacheGet, cacheSet } from "../../lib/cache";

export const runtime = "nodejs";

const SHEET_ID = "16BBOfasVwz8L6fPMungz_Y0EfF6Z9puskLAix3tCHzM";
const TAB_NAME = "Crew";
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

function parseGvizJson(text: string) {
  const cleaned = text.replace(/^\s*\/\*O_o\*\/\s*/m, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("GViz: Unexpected response");
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * Fetch all members with valid wallet addresses
 */
async function fetchMembersWithWallets(): Promise<MemberInfo[]> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?sheet=${TAB_NAME}&tqx=out:json&headers=0`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to fetch crew sheet");

  const text = await res.text();
  const gviz = parseGvizJson(text);
  const rows = gviz?.table?.rows || [];

  // Find header row
  let headerRowIdx = -1;
  let headerVals: string[] = [];

  for (let ri = 0; ri < Math.min(rows.length, 100); ri++) {
    const rowCells = rows[ri]?.c || [];
    const rowValsLower = rowCells.map((c: { v?: unknown; f?: unknown }) =>
      String(c?.v || c?.f || "").trim().toLowerCase()
    );
    const hasName = rowValsLower.includes("name");
    const hasStatus = rowValsLower.includes("status") || rowValsLower.includes("frequency");
    if (hasName && hasStatus) {
      headerRowIdx = ri;
      headerVals = rowCells.map((c: { v?: unknown; f?: unknown }) =>
        String(c?.v || c?.f || "").trim().toLowerCase()
      );
      break;
    }
  }

  if (headerRowIdx === -1) {
    throw new Error("Header row not found");
  }

  // Find column indices
  let idxId = headerVals.findIndex((h) =>
    ["id", "crewid", "memberid"].includes(h.replace(/[#\s\-_]/g, ""))
  );
  if (idxId === -1) idxId = 0;

  const idxName = headerVals.findIndex((h) => h === "name");
  let idxWallet = headerVals.findIndex((h) => h === "wallet");
  if (idxWallet === -1) {
    idxWallet = headerVals.findIndex((h) => h === "address" || h.includes("wallet"));
  }
  const idxTurtles = headerVals.findIndex((h) => h === "turtles" || h === "roles");

  if (idxWallet === -1) {
    return [];
  }

  const members: MemberInfo[] = [];

  for (let ri = headerRowIdx + 1; ri < rows.length; ri++) {
    const cells = rows[ri]?.c || [];
    const id = String(cells[idxId]?.v ?? cells[idxId]?.f ?? "").trim();
    const name = idxName >= 0 ? String(cells[idxName]?.v ?? cells[idxName]?.f ?? "").trim() : "";
    const wallet = String(cells[idxWallet]?.v ?? cells[idxWallet]?.f ?? "").trim();
    const turtlesRaw = idxTurtles >= 0 ? String(cells[idxTurtles]?.v ?? cells[idxTurtles]?.f ?? "") : "";

    // Validate wallet address
    if (wallet && wallet.startsWith("0x") && wallet.length === 42) {
      const turtles = turtlesRaw
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      members.push({
        memberId: id,
        name: name || `Member ${id}`,
        wallet: wallet.toLowerCase(),
        turtles,
      });
    }
  }

  return members;
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
  const [members, contracts] = await Promise.all([
    fetchMembersWithWallets(),
    getNFTContracts(),
  ]);

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
  const CONCURRENCY = 5;
  const memberQueue = [...members];
  let processed = 0;

  async function processMember(member: MemberInfo) {
    for (const contract of contracts) {
      const count = await fetchNFTCount(member.wallet, contract);
      if (count > 0) {
        const holders = collectionHolders.get(contract.address.toLowerCase());
        if (holders) {
          holders.set(member.memberId, { info: member, count });
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
    if (cached) {
      return NextResponse.json({ ...cached, cached: true });
    }

    // Aggregate fresh data
    const data = await aggregateLeaderboard();

    // Cache the result
    await cacheSet(CACHE_KEY, data, CACHE_TTL);

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      {
        collections: [],
        lastUpdated: Date.now(),
        cached: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
