"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CollectionCard } from "../ui/nft/CollectionCard";

interface Holder {
  memberId: string;
  memberName: string;
  nftCount: number;
  turtles: string[];
}

interface Collection {
  contractAddress: string;
  contractName: string;
  chain: string;
  description?: string;
  order?: number;
  holders: Holder[];
  totalHolders: number;
  totalNFTs: number;
}

interface LeaderboardData {
  collections: Collection[];
  lastUpdated: number;
  cached: boolean;
  memberCount?: number;
  error?: string;
}

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  return date.toLocaleString();
}

export default function NFTsPage() {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const res = await fetch("/api/nfts/leaderboard");
      if (!res.ok) throw new Error("Failed to fetch leaderboard");
      const json = await res.json();
      setData(json);
      setError(json.error || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      // Clear cache
      await fetch("/api/nfts/leaderboard/refresh", { method: "POST" });
      // Fetch fresh data
      await fetchData();
    } catch (err) {
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: 'var(--color-page-bg)',
        padding: "40px 20px",
      }}
    >
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 32,
            flexWrap: "wrap",
            gap: 16,
          }}
        >
          <div>
            <Link
              href="/"
              style={{
                fontSize: 14,
                color: 'var(--color-text-secondary)',
                textDecoration: "none",
                marginBottom: 8,
                display: "inline-flex",
                alignItems: "center",
                minHeight: 44,
              }}
            >
              &larr; Back to Home
            </Link>
            <h1
              style={{
                margin: "8px 0 4px 0",
                fontSize: 28,
                fontWeight: 700,
                color: 'var(--color-text-primary)',
              }}
            >
              PizzaDAO NFTs
            </h1>
          </div>

          <div style={{ textAlign: "right" }}>
            {data?.lastUpdated && (
              <p
                style={{
                  margin: "0 0 8px 0",
                  fontSize: 12,
                  color: 'var(--color-text-secondary)',
                }}
              >
                Last updated: {formatTimestamp(data.lastUpdated)}
                {data.cached && " (cached)"}
              </p>
            )}
            <button
              onClick={handleRefresh}
              disabled={refreshing || loading}
              style={{
                padding: "10px 16px",
                minHeight: 44,
                fontSize: 14,
                fontWeight: 500,
                color: refreshing ? "#999" : "#333",
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                cursor: refreshing || loading ? "not-allowed" : "pointer",
              }}
            >
              {refreshing ? "Refreshing..." : "Refresh Data"}
            </button>
          </div>
        </div>

        {/* Loading state */}
        {loading && (
          <div style={{ display: "grid", gap: 24 }}>
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                style={{
                  height: 300,
                  background: 'var(--color-surface)',
                  borderRadius: 14,
                  border: '1px solid var(--color-border)',
                  animation: "pulse 1.5s infinite",
                }}
              />
            ))}
          </div>
        )}

        {/* Error state */}
        {!loading && error && (
          <div
            style={{
              padding: 40,
              textAlign: "center",
              background: 'var(--color-surface)',
              borderRadius: 14,
              border: '1px solid var(--color-border)',
            }}
          >
            <p style={{ fontSize: 16, color: "#c00", marginBottom: 16 }}>
              {error}
            </p>
            <button
              onClick={fetchData}
              style={{
                padding: "12px 20px",
                minHeight: 44,
                fontSize: 14,
                fontWeight: 500,
                color: 'var(--color-btn-primary-text)',
                background: 'var(--color-btn-primary-bg)',
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              Try Again
            </button>
          </div>
        )}

        {/* Collections grid */}
        {!loading && !error && data && (
          <>
            {data.collections.length === 0 ? (
              <div
                style={{
                  padding: 40,
                  textAlign: "center",
                  background: 'var(--color-surface)',
                  borderRadius: 14,
                  border: '1px solid var(--color-border)',
                }}
              >
                <p style={{ fontSize: 16, color: 'var(--color-text-secondary)' }}>
                  No collections with member holders found.
                </p>
                <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginTop: 8 }}>
                  {data.memberCount === 0
                    ? "No members have connected wallets yet."
                    : "Members may not hold any of the tracked collections."}
                </p>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 24 }}>
                {data.collections.map((collection) => (
                  <CollectionCard
                    key={collection.contractAddress}
                    contractAddress={collection.contractAddress}
                    contractName={collection.contractName}
                    chain={collection.chain}
                    description={collection.description}
                    totalHolders={collection.totalHolders}
                    totalNFTs={collection.totalNFTs}
                    holders={collection.holders}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* Footer info */}
        {!loading && data && data.memberCount !== undefined && (
          <p
            style={{
              marginTop: 32,
              textAlign: "center",
              fontSize: 12,
              color: 'var(--color-text-secondary)',
            }}
          >
            Scanning {data.memberCount} member wallets
          </p>
        )}
      </div>

      <style jsx>{`
        @keyframes pulse {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.5;
          }
        }
      `}</style>
    </div>
  );
}
