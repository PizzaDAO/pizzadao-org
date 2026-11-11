// Precomputed profile collection counts (POAPs, NFTs, tickets).
//
// Why: the profile used to fetch the full POAP and NFT lists (multi-chain Alchemy fan-out per
// wallet, KV-cached only after the first cold call) just to show how many there were. The counts
// now live in MemberCollectionStats, filled by the nightly cron and refreshed in the background
// when a view finds them stale. Public data only: counts, never wallet addresses.

import { prisma } from "@/app/lib/db";
import { loadSettings } from "@/app/lib/settings";
import { effectiveInt } from "@/app/lib/settings/numbers";
import { fetchFilteredPOAPs } from "@/app/lib/poap";
import { fetchPizzaDAONFTs } from "@/app/lib/nft";
import { getEvmWalletsForMember, getWalletForMember } from "@/app/lib/wallet-lookup";
import { getTicketSummary } from "@/app/lib/unlock/scan";

export interface CollectionStats {
  poapCount: number;
  nftCount: number;
  nftCollections: number;
  ticketCount: number;
  hasWallet: boolean;
}

export interface StoredCollectionStats extends CollectionStats {
  computedAt: Date;
}

async function walletsFor(memberId: string): Promise<string[]> {
  let wallets = await getEvmWalletsForMember(memberId);
  if (wallets.length === 0) {
    const sheetWallet = await getWalletForMember(memberId);
    if (sheetWallet) wallets = [sheetWallet];
  }
  return wallets;
}

/** Live computation (slow: external calls). Used by the cron and the background refresh. */
export async function computeCollectionStats(memberId: string): Promise<CollectionStats> {
  const [wallets, tickets] = await Promise.all([
    walletsFor(memberId),
    getTicketSummary(memberId).catch(() => ({ totalTickets: 0 })),
  ]);
  const ticketCount = tickets.totalTickets ?? 0;
  if (wallets.length === 0) {
    return { poapCount: 0, nftCount: 0, nftCollections: 0, ticketCount, hasWallet: false };
  }

  const [poapResults, nftResults] = await Promise.all([
    Promise.all(wallets.map((w) => fetchFilteredPOAPs(w))),
    Promise.all(wallets.map((w) => fetchPizzaDAONFTs(w))),
  ]);

  // A partial NFT lookup (a chain failed) must not overwrite good counts with lower ones: throw so
  // refreshCollectionStats writes nothing and the previous row stays. POAP lookups throw on failure.
  for (const r of nftResults) {
    if (r.error) throw new Error(`NFT lookup incomplete: ${r.error}`);
  }

  const poaps = new Set<string>();
  for (const r of poapResults) for (const p of r.poaps) poaps.add(String(p.tokenId));

  const nfts = new Set<string>();
  const collections = new Set<string>();
  for (const r of nftResults) {
    for (const n of r.nfts) {
      nfts.add(`${n.chain}:${n.contractAddress}:${n.tokenId}`);
      collections.add(`${n.chain}:${n.contractAddress}`);
    }
  }
  return {
    poapCount: poaps.size,
    nftCount: nfts.size,
    nftCollections: collections.size,
    ticketCount,
    hasWallet: true,
  };
}

/** The stored row, or null when missing (or the table does not exist yet). Never throws. */
export async function readCollectionStats(memberId: string): Promise<StoredCollectionStats | null> {
  try {
    return await prisma.memberCollectionStats.findUnique({ where: { memberId } });
  } catch {
    return null;
  }
}

const inFlight = new Set<string>();

/**
 * Recompute one member's counts and store them. Throws if the computation fails (nothing is
 * written then). Single-flight: a concurrent call for the same member returns null at once.
 */
export async function refreshCollectionStats(memberId: string): Promise<CollectionStats | null> {
  if (inFlight.has(memberId)) return null;
  inFlight.add(memberId);
  try {
    return await refreshOnce(memberId);
  } finally {
    inFlight.delete(memberId);
  }
}

async function refreshOnce(memberId: string): Promise<CollectionStats> {
  const stats = await computeCollectionStats(memberId);
  const data = { ...stats, computedAt: new Date() };
  try {
    await prisma.memberCollectionStats.upsert({
      where: { memberId },
      create: { memberId, ...data },
      update: data,
    });
  } catch {
    // best effort: the caller still gets the fresh numbers
  }
  return stats;
}

export function isRefreshing(memberId: string): boolean {
  return inFlight.has(memberId);
}

export function isStale(computedAt: Date, freshHours: number, now: number = Date.now()): boolean {
  return now - computedAt.getTime() > freshHours * 60 * 60 * 1000;
}

export async function collectionStatsFreshHours(): Promise<number> {
  return effectiveInt("profile.collectionStatsFreshHours", await loadSettings());
}
