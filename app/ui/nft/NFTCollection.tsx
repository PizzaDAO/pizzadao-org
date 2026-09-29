"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { NFTCard } from "./NFTCard";
import { NFTCollectionResponse, NFTDisplayItem } from "@/app/lib/nft-types";

type NFTCollectionProps = {
  memberId: string;
  maxPerCollection?: number;
  showConnectPrompt?: boolean;
};

type GroupedNFT = {
  contract: string;
  contractName: string;
  chain: string;
  order?: number;
  nfts: NFTDisplayItem[];
  displayNfts: NFTDisplayItem[];
  overflow: number;
};

/**
 * NFTCollection — capers-48272 (Phase 4e restyle)
 * Cream/ink/tomato palette via globals.css tokens. Each contract grouped
 * with an overflow "+N" pill that expands inline.
 */
export function NFTCollection({ memberId, maxPerCollection = 3, showConnectPrompt = true }: NFTCollectionProps) {
  const [data, setData] = useState<NFTCollectionResponse | null>(null);
  const [fullData, setFullData] = useState<NFTCollectionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandLoading, setExpandLoading] = useState(false);

  const toggleGroup = useCallback(async (groupKey: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });

    // If expanding and we haven't fetched full data yet, fetch it
    if (!expandedGroups.has(groupKey) && !fullData) {
      setExpandLoading(true);
      try {
        const res = await fetch(`/api/nfts/${memberId}`);
        const json = await res.json();
        setFullData(json);
      } catch {
        // Keep using limited data
      } finally {
        setExpandLoading(false);
      }
    }
  }, [expandedGroups, fullData, memberId]);

  const fetchNFTs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/nfts/${memberId}?limit=${maxPerCollection}`);
      const json = await res.json();
      setData(json);
    } catch {
      setData({ nfts: [], totalCount: 0, walletAddress: null, error: "Failed to load" });
    } finally {
      setLoading(false);
    }
  }, [memberId, maxPerCollection]);

  useEffect(() => {
    fetchNFTs();
  }, [fetchNFTs]);

  // Build a lookup of group totals from the API groups metadata
  const groupTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of data?.groups || []) {
      map.set(`${g.chain}:${g.contract}`, g.totalInGroup);
    }
    return map;
  }, [data?.groups]);

  // When full data is loaded, build a lookup for full NFT lists per group
  const fullGroupNfts = useMemo(() => {
    if (!fullData?.nfts) return new Map<string, NFTDisplayItem[]>();
    const map = new Map<string, NFTDisplayItem[]>();
    for (const nft of fullData.nfts) {
      const key = `${nft.chain}:${nft.contractAddress}`;
      const list = map.get(key) || [];
      list.push(nft);
      map.set(key, list);
    }
    return map;
  }, [fullData?.nfts]);

  // Group NFTs by contract address
  const groupedNFTs = useMemo(() => {
    if (!data?.nfts) return [];

    const groups: Record<string, GroupedNFT> = {};

    for (const nft of data.nfts) {
      const key = `${nft.chain}:${nft.contractAddress}`;
      if (!groups[key]) {
        groups[key] = {
          contract: nft.contractAddress,
          contractName: nft.contractName,
          chain: nft.chain,
          order: nft.order,
          nfts: [],
          displayNfts: [],
          overflow: 0,
        };
      }
      groups[key].nfts.push(nft);
    }

    // Calculate display NFTs and overflow for each group, then sort by order
    return Object.values(groups)
      .map((group) => {
        const key = `${group.chain}:${group.contract}`;
        // Use API group metadata for total count (accounts for limited response)
        const totalInGroup = groupTotals.get(key) || group.nfts.length;
        return {
          ...group,
          displayNfts: group.nfts.slice(0, maxPerCollection),
          overflow: Math.max(0, totalInGroup - maxPerCollection),
        };
      })
      .sort((a, b) => {
        // Items with order come first, sorted by order value
        // Items without order come last
        if (a.order !== undefined && b.order !== undefined) {
          return a.order - b.order;
        }
        if (a.order !== undefined) return -1;
        if (b.order !== undefined) return 1;
        return 0;
      });
  }, [data?.nfts, maxPerCollection, groupTotals]);

  // Section wrapper class — divider above + heading row.
  const sectionClass = "mt-6 pt-6 border-t border-rule";

  // Heading link — Asap Condensed with tomato hover.
  const headingLink = (
    <Link
      href="/nfts"
      className="block no-underline text-foreground hover:text-tomato transition-colors"
    >
      <h3 className="font-display text-lg font-semibold m-0 mb-4">NFT Collection</h3>
    </Link>
  );

  // Show prompt if no wallet is saved (only if showConnectPrompt is true)
  if (!loading && data?.noWallet) {
    if (!showConnectPrompt) {
      return null; // Hide completely on profile page if no wallet
    }
    return (
      <div className={sectionClass}>
        {headingLink}
        <div className="flex flex-col items-center justify-center gap-4 px-4 py-8 rounded-[var(--radius)] border border-dashed border-rule bg-background">
          <p className="m-0 text-sm text-muted-foreground italic text-center">
            Add a wallet in your Wallet Manager above to display your NFT collection
          </p>
        </div>
      </div>
    );
  }

  // Show prompt to get NFTs if wallet connected but no NFTs found
  // Hide on profile pages (showConnectPrompt=false) — don't expose wallet info
  if (!loading && data?.walletAddress && data.totalCount === 0) {
    if (!showConnectPrompt) return null;
    return (
      <div className={sectionClass}>
        {headingLink}
        <div className="flex flex-col items-center justify-center gap-4 px-4 py-8 rounded-[var(--radius)] border border-dashed border-rule bg-background">
          <p className="m-0 text-sm text-muted-foreground italic text-center">
            No PizzaDAO NFTs found in this wallet
          </p>
          <a
            href="/nfts"
            className="inline-block px-5 py-2.5 rounded-[var(--radius)] bg-primary text-primary-foreground font-display font-semibold text-sm no-underline hover:bg-tomato hover:text-cream transition-colors"
          >
            Browse PizzaDAO NFTs
          </a>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={sectionClass}>
        {headingLink}
        <div className="flex gap-2.5 flex-wrap">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="w-20 h-20 rounded-[var(--radius)] bg-muted animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={sectionClass}>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <Link
          href="/nfts"
          className="no-underline text-foreground hover:text-tomato transition-colors"
        >
          <h3 className="font-display text-lg font-semibold m-0">
            NFT Collection
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({data!.totalCount})
            </span>
          </h3>
        </Link>
        {showConnectPrompt && data?.walletAddress && (
          <a
            href={`https://opensea.io/${data.walletAddress}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground hover:text-tomato no-underline transition-colors"
          >
            View on OpenSea &rarr;
          </a>
        )}
      </div>

      <div className="flex flex-wrap gap-2.5">
        {groupedNFTs.map((group) => {
          const groupKey = `${group.chain}:${group.contract}`;
          const isExpanded = expandedGroups.has(groupKey);
          const isGroupLoading = isExpanded && expandLoading && !fullGroupNfts.has(groupKey);
          // When expanded, prefer full data if available, else fall back to limited data
          const allNftsForGroup = fullGroupNfts.get(groupKey) || group.nfts;
          const nftsToShow = isExpanded ? allNftsForGroup : group.displayNfts;

          return (
            <React.Fragment key={groupKey}>
              {nftsToShow.map((nft) => (
                <NFTCard
                  key={`${nft.contractAddress}-${nft.tokenId}`}
                  nft={nft}
                  size="small"
                />
              ))}
              {isGroupLoading && Array.from({ length: Math.min(group.overflow, 6) }).map((_, i) => (
                <div
                  key={`shimmer-${i}`}
                  className="w-20 h-20 rounded-[var(--radius)] bg-muted animate-pulse"
                />
              ))}
              {group.overflow > 0 && !isExpanded && (
                <button
                  onClick={() => toggleGroup(groupKey)}
                  className="w-20 h-20 rounded-[var(--radius)] border border-dashed border-rule bg-muted hover:border-tomato hover:bg-tomato/10 flex items-center justify-center font-display font-semibold text-muted-foreground transition-colors cursor-pointer"
                  title={`Show ${group.overflow} more ${group.contractName}`}
                >
                  +{group.overflow}
                </button>
              )}
              {group.overflow > 0 && isExpanded && (
                <button
                  onClick={() => toggleGroup(groupKey)}
                  className="w-20 h-20 rounded-[var(--radius)] border border-rule bg-muted hover:bg-muted/70 flex items-center justify-center font-display text-lg font-semibold text-muted-foreground transition-colors cursor-pointer"
                  title="Show less"
                >
                  −
                </button>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
