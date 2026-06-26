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

/**
 * NFTsPage — capers-48272 (Phase 4e restyle)
 * Cream-on-cream collections gallery with Asap Condensed h1.
 * Refresh button uses the secondary outline style; cards use shared `card()`.
 */
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
    } catch {
      // ignore — error state will surface on next fetch
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground px-5 py-10">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-start mb-8 flex-wrap gap-4">
          <div>
            <Link
              href="/"
              className="text-sm text-muted-foreground hover:text-tomato no-underline inline-flex items-center min-h-[44px] transition-colors"
            >
              &larr; Back to Home
            </Link>
            <h1 className="font-display mt-2 mb-1 text-4xl font-extrabold tracking-tight text-foreground">
              NFTs
            </h1>
            {!loading && data && data.memberCount !== undefined && (
              <p className="m-0 text-sm text-muted-foreground">
                Scanning {data.memberCount} member wallet{data.memberCount === 1 ? "" : "s"}
                {data.collections.length > 0 && (
                  <>
                    {" · "}
                    {data.collections.length} collection
                    {data.collections.length === 1 ? "" : "s"}
                  </>
                )}
              </p>
            )}
          </div>

          <div className="text-right">
            {data?.lastUpdated && (
              <p className="m-0 mb-2 text-xs text-muted-foreground italic">
                Last updated: {formatTimestamp(data.lastUpdated)}
                {data.cached && " (cached)"}
              </p>
            )}
            <button
              onClick={handleRefresh}
              disabled={refreshing || loading}
              className={`px-4 py-3 min-h-[44px] text-sm font-display font-semibold rounded-[var(--radius)] border border-rule bg-card text-foreground hover:bg-muted transition-colors ${
                refreshing || loading
                  ? "opacity-50 cursor-not-allowed"
                  : "cursor-pointer"
              }`}
            >
              {refreshing ? "Refreshing..." : "Refresh Data"}
            </button>
          </div>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="grid gap-6">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-[300px] rounded-[var(--radius)] border border-rule bg-card animate-pulse"
              />
            ))}
          </div>
        )}

        {/* Error state */}
        {!loading && error && (
          <div className="p-10 text-center rounded-[var(--radius)] border border-rule bg-card">
            <p className="text-base text-destructive italic mb-4">{error}</p>
            <button
              onClick={fetchData}
              className="px-5 py-3 min-h-[44px] text-sm font-display font-semibold rounded-[var(--radius)] bg-primary text-primary-foreground hover:bg-tomato hover:text-cream border-0 cursor-pointer transition-colors"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Collections grid */}
        {!loading && !error && data && (
          <>
            {data.collections.length === 0 ? (
              <div className="p-10 text-center rounded-[var(--radius)] border border-rule bg-card">
                <p className="text-base text-muted-foreground italic">
                  No collections with member holders found.
                </p>
                <p className="mt-2 text-sm text-muted-foreground italic">
                  {data.memberCount === 0
                    ? "No members have connected wallets yet."
                    : "Members may not hold any of the tracked collections."}
                </p>
              </div>
            ) : (
              <div className="grid gap-6">
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
      </div>
    </div>
  );
}
