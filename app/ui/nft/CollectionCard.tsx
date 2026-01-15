"use client";

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

function card(): React.CSSProperties {
  return {
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: 14,
    padding: 20,
    boxShadow: "0 8px 30px rgba(0,0,0,0.06)",
    background: "white",
  };
}

function chainBadge(chain: string): React.CSSProperties {
  const colors: Record<string, { bg: string; text: string }> = {
    ethereum: { bg: "#627EEA20", text: "#627EEA" },
    base: { bg: "#0052FF20", text: "#0052FF" },
    polygon: { bg: "#8247E520", text: "#8247E5" },
    zora: { bg: "#00000010", text: "#000" },
    optimism: { bg: "#FF042020", text: "#FF0420" },
  };

  const { bg, text } = colors[chain.toLowerCase()] || {
    bg: "#00000010",
    text: "#666",
  };

  return {
    display: "inline-block",
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: 600,
    color: text,
    background: bg,
    borderRadius: 6,
    textTransform: "capitalize" as const,
  };
}

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
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 12,
        }}
      >
        <a
          href={openSeaUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            margin: 0,
            fontSize: 18,
            fontWeight: 600,
            color: "#111",
            textDecoration: "none",
          }}
        >
          {contractName} ↗
        </a>
        <span style={chainBadge(chain)}>{chain}</span>
      </div>

      {/* Description */}
      {description && (
        <p
          style={{
            margin: "0 0 16px 0",
            fontSize: 14,
            color: "#666",
            lineHeight: 1.5,
          }}
        >
          {description}
        </p>
      )}

      {/* Stats */}
      <div
        style={{
          display: "flex",
          gap: 16,
          marginBottom: 16,
          fontSize: 14,
          color: "#888",
        }}
      >
        <span>{totalHolders} holders</span>
        <span>{totalNFTs} NFTs</span>
      </div>

      {/* Leaderboard */}
      <HolderLeaderboard holders={holders} />
    </div>
  );
}
