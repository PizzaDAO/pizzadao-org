"use client";

import React, { useState } from "react";
import Image from "next/image";
import { NFTDisplayItem } from "@/app/lib/nft-types";

type NFTCardProps = {
  nft: NFTDisplayItem;
  size?: "small" | "medium" | "large";
};

// Chain identifiers — labels only. Visual styling uses brand tokens.
const CHAIN_LABELS: Record<string, string> = {
  ethereum: "ETH",
  base: "BASE",
  polygon: "POLY",
  zora: "ZORA",
  optimism: "OP",
};

const OPENSEA_CHAIN_SLUGS: Record<string, string> = {
  ethereum: "ethereum",
  base: "base",
  polygon: "matic",
  zora: "zora",
  optimism: "optimism",
};

function getOpenSeaUrl(nft: NFTDisplayItem): string {
  const chainSlug = OPENSEA_CHAIN_SLUGS[nft.chain] || nft.chain;
  return `https://opensea.io/assets/${chainSlug}/${nft.contractAddress}/${nft.tokenId}`;
}

const SIZE_PX: Record<NonNullable<NFTCardProps["size"]>, number> = {
  small: 80,
  medium: 120,
  large: 180,
};

/**
 * NFTCard — capers-48272 (Phase 4e restyle)
 * Square image tile with rounded corners + ink-tinted border. Chain badge
 * uses the brand ink-on-cream pill rather than the chain's native brand color
 * so the grid reads consistently against the cream surface.
 */
export function NFTCard({ nft, size = "medium" }: NFTCardProps) {
  const [imageError, setImageError] = useState(false);
  const dimensions = SIZE_PX[size];
  const chainLabel = CHAIN_LABELS[nft.chain] || nft.chain.toUpperCase().slice(0, 4);
  const openSeaUrl = getOpenSeaUrl(nft);

  return (
    <a
      href={openSeaUrl}
      target="_blank"
      rel="noreferrer"
      className="group relative block rounded-[var(--radius)] border border-rule bg-muted overflow-hidden flex-shrink-0 hover:border-tomato hover:shadow-md transition-all duration-200"
      style={{ width: dimensions, height: dimensions }}
      title={`${nft.name} - ${nft.contractName}`}
    >
      {!imageError && (nft.thumbnailUrl || nft.imageUrl) ? (
        <Image
          src={nft.thumbnailUrl || nft.imageUrl}
          alt={nft.name}
          width={dimensions}
          height={dimensions}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
          style={{ objectFit: "cover" }}
          onError={() => setImageError(true)}
          unoptimized
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-muted-foreground text-center px-2 italic"
             style={{ fontSize: size === "small" ? 10 : 12 }}>
          {nft.name}
        </div>
      )}
      {/* Chain badge — ink pill on cream */}
      <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase font-display bg-ink/85 text-cream tracking-wide">
        {chainLabel}
      </div>
    </a>
  );
}
