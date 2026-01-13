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
      console.error("Refresh error:", err);
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
        background: "#fafafa",
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
                color: "#666",
                textDecoration: "none",
                marginBottom: 8,
                display: "inline-block",
              }}
            >
              &larr; Back to Home
            </Link>
            <h1
              style={{
                margin: "8px 0 4px 0",
                fontSize: 28,
                fontWeight: 700,
                color: "#111",
              }}
            >
              NFT Collections
            </h1>
            <p style={{ margin: 0, fontSize: 14, color: "#666" }}>
              PizzaDAO member holder leaderboards
            </p>
          </div>

          <div style={{ textAlign: "right" }}>
            {data?.lastUpdated && (
              <p
                style={{
                  margin: "0 0 8px 0",
                  fontSize: 12,
                  color: "#888",
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
                padding: "8px 16px",
                fontSize: 14,
                fontWeight: 500,
                color: refreshing ? "#999" : "#333",
                background: "white",
                border: "1px solid rgba(0,0,0,0.12)",
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
                  background: "white",
                  borderRadius: 14,
                  border: "1px solid rgba(0,0,0,0.08)",
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
              background: "white",
              borderRadius: 14,
              border: "1px solid rgba(0,0,0,0.08)",
            }}
          >
            <p style={{ fontSize: 16, color: "#c00", marginBottom: 16 }}>
              {error}
            </p>
            <button
              onClick={fetchData}
              style={{
                padding: "10px 20px",
                fontSize: 14,
                fontWeight: 500,
                color: "white",
                background: "#111",
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
                  background: "white",
                  borderRadius: 14,
                  border: "1px solid rgba(0,0,0,0.08)",
                }}
              >
                <p style={{ fontSize: 16, color: "#666" }}>
                  No collections with member holders found.
                </p>
                <p style={{ fontSize: 14, color: "#999", marginTop: 8 }}>
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
              color: "#888",
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
