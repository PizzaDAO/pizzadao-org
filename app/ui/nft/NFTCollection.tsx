"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { NFTCard } from "./NFTCard";
import { NFTCollectionResponse, NFTDisplayItem } from "@/app/lib/nft-types";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";

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

export function NFTCollection({ memberId, maxPerCollection = 3, showConnectPrompt = true }: NFTCollectionProps) {
  const [data, setData] = useState<NFTCollectionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [walletSaved, setWalletSaved] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const { address, isConnected } = useAccount();

  const toggleGroup = useCallback((groupKey: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
      }
      return next;
    });
  }, []);

  const fetchNFTs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/nfts/${memberId}`);
      const json = await res.json();
      setData(json);
    } catch (e) {
      setData({ nfts: [], totalCount: 0, walletAddress: null, error: "Failed to load" });
    } finally {
      setLoading(false);
    }
  }, [memberId]);

  useEffect(() => {
    fetchNFTs();
  }, [fetchNFTs]);

  // When user connects wallet and we have no wallet saved, save it
  useEffect(() => {
    async function saveWallet() {
      if (isConnected && address && data?.noWallet && !walletSaved && !saving) {
        setSaving(true);
        try {
          const res = await fetch("/api/wallet", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ memberId, walletAddress: address }),
          });
          const resData = await res.json();
          if (res.ok) {
            setWalletSaved(true);
            // Refetch NFTs with the new wallet
            await fetchNFTs();
          } else {
          }
        } catch (e) {
        } finally {
          setSaving(false);
        }
      }
    }
    saveWallet();
  }, [isConnected, address, data?.noWallet, walletSaved, saving, memberId, fetchNFTs]);

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
      .map((group) => ({
        ...group,
        displayNfts: group.nfts.slice(0, maxPerCollection),
        overflow: Math.max(0, group.nfts.length - maxPerCollection),
      }))
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
  }, [data?.nfts, maxPerCollection]);

  const sectionStyle: React.CSSProperties = {
    marginTop: 24,
    paddingTop: 24,
    borderTop: '1px solid var(--color-divider)',
  };

  // Show connect wallet prompt if no wallet is saved (only if showConnectPrompt is true)
  if (!loading && data?.noWallet && !walletSaved) {
    if (!showConnectPrompt) {
      return null; // Hide completely on profile page if no wallet
    }
    return (
      <div style={sectionStyle}>
        <Link href="/nfts" style={{ textDecoration: "none", color: "inherit" }}>
          <h3 style={{ fontSize: 18, marginTop: 0, marginBottom: 16, fontWeight: 600 }}>
            NFT Collection
          </h3>
        </Link>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "32px 16px",
            borderRadius: 12,
            border: "1px dashed rgba(0,0,0,0.2)",
            background: 'var(--color-page-bg)',
            gap: 16,
          }}
        >
          <p style={{ margin: 0, fontSize: 14, opacity: 0.7, textAlign: "center" }}>
            {saving ? "Saving wallet..." : "Connect your wallet to display your NFT collection"}
          </p>
          {!saving && <ConnectButton />}
        </div>
      </div>
    );
  }

  // Show prompt to get NFTs if wallet connected but no NFTs found
  if (!loading && data?.walletAddress && data.totalCount === 0) {
    return (
      <div style={sectionStyle}>
        <Link href="/nfts" style={{ textDecoration: "none", color: "inherit" }}>
          <h3 style={{ fontSize: 18, marginTop: 0, marginBottom: 16, fontWeight: 600 }}>
            NFT Collection
          </h3>
        </Link>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "32px 16px",
            borderRadius: 12,
            border: "1px dashed rgba(0,0,0,0.2)",
            background: 'var(--color-page-bg)',
            gap: 16,
          }}
        >
          <p style={{ margin: 0, fontSize: 14, opacity: 0.7, textAlign: "center" }}>
            No PizzaDAO NFTs found in this wallet
          </p>
          <a
            href="/nfts"
            style={{
              display: "inline-block",
              padding: "10px 20px",
              borderRadius: 10,
              background: 'var(--color-btn-primary-bg)',
              color: 'var(--color-btn-primary-text)',
              fontWeight: 600,
              fontSize: 14,
              textDecoration: "none",
            }}
          >
            Browse PizzaDAO NFTs
          </a>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={sectionStyle}>
        <Link href="/nfts" style={{ textDecoration: "none", color: "inherit" }}>
          <h3 style={{ fontSize: 18, marginTop: 0, marginBottom: 16, fontWeight: 600 }}>
            NFT Collection
          </h3>
        </Link>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                width: 80,
                height: 80,
                borderRadius: 12,
                background: "linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)",
                backgroundSize: "200% 100%",
                animation: "shimmer 1.5s infinite",
              }}
            />
          ))}
        </div>
        <style>{`
          @keyframes shimmer {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div style={sectionStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <Link href="/nfts" style={{ textDecoration: "none", color: "inherit" }}>
          <h3 style={{ fontSize: 18, margin: 0, fontWeight: 600 }}>
            NFT Collection
            <span
              style={{ fontSize: 14, fontWeight: 400, opacity: 0.6, marginLeft: 8 }}
            >
              ({data!.totalCount})
            </span>
          </h3>
        </Link>
        {data?.walletAddress && (
          <a
            href={`https://opensea.io/${data.walletAddress}`}
            target="_blank"
            rel="noreferrer"
            style={{
              fontSize: 12,
              opacity: 0.6,
              color: "inherit",
              textDecoration: "none",
            }}
          >
            View on OpenSea &rarr;
          </a>
        )}
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        {groupedNFTs.map((group) => {
          const groupKey = `${group.chain}:${group.contract}`;
          const isExpanded = expandedGroups.has(groupKey);
          const nftsToShow = isExpanded ? group.nfts : group.displayNfts;

          return (
            <React.Fragment key={groupKey}>
              {nftsToShow.map((nft) => (
                <NFTCard
                  key={`${nft.contractAddress}-${nft.tokenId}`}
                  nft={nft}
                  size="small"
                />
              ))}
              {group.overflow > 0 && !isExpanded && (
                <button
                  onClick={() => toggleGroup(groupKey)}
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: 12,
                    border: "2px dashed rgba(0,0,0,0.2)",
                    background: "#f5f5f5",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--color-text-secondary)',
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "#f59e0b";
                    e.currentTarget.style.background = "#fef3c7";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "rgba(0,0,0,0.2)";
                    e.currentTarget.style.background = "#f5f5f5";
                  }}
                  title={`Show ${group.overflow} more ${group.contractName}`}
                >
                  +{group.overflow}
                </button>
              )}
              {group.overflow > 0 && isExpanded && (
                <button
                  onClick={() => toggleGroup(groupKey)}
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: 12,
                    border: "2px solid rgba(0,0,0,0.15)",
                    background: "#e5e5e5",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 18,
                    fontWeight: 600,
                    color: 'var(--color-text-secondary)',
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "rgba(0,0,0,0.3)";
                    e.currentTarget.style.background = "#d5d5d5";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "rgba(0,0,0,0.15)";
                    e.currentTarget.style.background = "#e5e5e5";
                  }}
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
