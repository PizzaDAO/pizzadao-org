"use client";

import { card } from "../shared-styles";
import { HolderLeaderboard } from "./HolderLeaderboard";

interface Holder {
  memberId: string;
  memberName: string;
  nftCount: number;
  turtles: string[];
}

interface CollectionCardProps {
  contractAddress: string;
  contractName: string;
  chain: string;
  description?: string;
  totalHolders: number;
  totalNFTs: number;
  holders: Holder[];
}

function getOpenSeaUrl(contractAddress: string, chain: string): string {
  // Map chain names to OpenSea chain slugs
  const chainMap: Record<string, string> = {
    ethereum: 'ethereum',
    base: 'base',
    polygon: 'matic',
    zora: 'zora',
    optimism: 'optimism',
    arbitrum: 'arbitrum',
  };
  const chainSlug = chainMap[chain.toLowerCase()] || chain.toLowerCase();
  return `https://opensea.io/assets/${chainSlug}/${contractAddress}`;
}

/**
 * CollectionCard — capers-48272 (Phase 4e restyle)
 * Uses shared `card()` primitive (cream surface, ink-tinted border, radius).
 * Chain badge is an ink pill on muted bg (drops the per-chain brand colors
 * for visual consistency with the cream/ink/tomato palette).
 */
export function CollectionCard({
  contractAddress,
  contractName,
  chain,
  description,
  totalHolders,
  totalNFTs,
  holders,
}: CollectionCardProps) {
  const openSeaUrl = getOpenSeaUrl(contractAddress, chain);

  return (
    <div style={card()}>
      {/* Header */}
      <div className="flex justify-between items-start gap-3 flex-wrap">
        <a
          href={openSeaUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-display text-lg font-semibold text-foreground hover:text-tomato no-underline inline-flex items-center min-h-[44px] transition-colors"
        >
          {contractName} ↗
        </a>
        <span className="inline-block px-2.5 py-1 text-xs font-semibold font-display uppercase tracking-wide rounded bg-ink/85 text-cream">
          {chain}
        </span>
      </div>

      {/* Description */}
      {description && (
        <p className="m-0 text-sm text-muted-foreground leading-relaxed">
          {description}
        </p>
      )}

      {/* Stats — Asap Condensed counts */}
      <div className="flex gap-4 text-sm text-muted-foreground">
        <span>
          <span className="font-display font-semibold text-foreground">{totalHolders}</span> holders
        </span>
        <span>
          <span className="font-display font-semibold text-foreground">{totalNFTs}</span> NFTs
        </span>
      </div>

      {/* Leaderboard */}
      <HolderLeaderboard holders={holders} />
    </div>
  );
}
