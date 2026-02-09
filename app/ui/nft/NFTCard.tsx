"use client";

import React, { useState } from "react";
import Image from "next/image";
import { NFTDisplayItem } from "@/app/lib/nft-types";

type NFTCardProps = {
  nft: NFTDisplayItem;
  size?: "small" | "medium" | "large";
};

const CHAIN_COLORS: Record<string, string> = {
  ethereum: "#627eea",
  base: "#0052ff",
  polygon: "#8247e5",
  zora: "#000000",
  optimism: "#ff0420",
};

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

function cardStyle(size: "small" | "medium" | "large"): React.CSSProperties {
  const sizes = { small: 80, medium: 120, large: 180 };
  return {
    width: sizes[size],
    height: sizes[size],
    borderRadius: 12,
    border: '1px solid var(--color-border)',
    overflow: "hidden",
    position: "relative",
    background: 'var(--color-page-bg)',
    flexShrink: 0,
  };
}

export function NFTCard({ nft, size = "medium" }: NFTCardProps) {
  const [imageError, setImageError] = useState(false);
  const dimensions = { small: 80, medium: 120, large: 180 }[size];
  const chainColor = CHAIN_COLORS[nft.chain] || "#888";
  const chainLabel = CHAIN_LABELS[nft.chain] || nft.chain.toUpperCase().slice(0, 4);
  const openSeaUrl = getOpenSeaUrl(nft);

  return (
    <a
      href={openSeaUrl}
      target="_blank"
      rel="noreferrer"
      style={{ ...cardStyle(size), display: "block", textDecoration: "none" }}
      title={`${nft.name} - ${nft.contractName}`}
    >
      {!imageError && (nft.thumbnailUrl || nft.imageUrl) ? (
        <Image
          src={nft.thumbnailUrl || nft.imageUrl}
          alt={nft.name}
          width={dimensions}
          height={dimensions}
          style={{ objectFit: "cover", width: "100%", height: "100%" }}
          onError={() => setImageError(true)}
          unoptimized
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: size === "small" ? 10 : 12,
            color: "rgba(0,0,0,0.4)",
            textAlign: "center",
            padding: 8,
            boxSizing: "border-box",
          }}
        >
          {nft.name}
        </div>
      )}
      {/* Chain badge */}
      <div
        style={{
          position: "absolute",
          bottom: 4,
          right: 4,
          background: chainColor,
          color: 'var(--color-btn-primary-text)',
          fontSize: 8,
          fontWeight: 700,
          padding: "2px 4px",
          borderRadius: 4,
          textTransform: "uppercase",
        }}
      >
        {chainLabel}
      </div>
    </a>
  );
}
