"use client";

import { useEffect, useState } from "react";
import { CollectionCard } from "../ui/nft/CollectionCard";
import {
  EditorialMasthead,
  EditorialPage,
  EmptyState,
  paperCard,
  pillInk,
  pillOutline,
} from "@/app/ui/shared/Editorial";

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
 * NFTsPage — editorial restyle: § overline masthead with the scan summary as
 * the dek, refresh as an outline pill, paper-soft loading/empty/error states.
 * Fetching and refresh behavior are unchanged.
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
    <EditorialPage width="max-w-6xl">
      <EditorialMasthead
        overline="The Collection"
        title={
          <>
            Member <span className="text-tomato underline-scribble">NFTs</span>
          </>
        }
        dek={
          !loading && data && data.memberCount !== undefined ? (
            <>
              Scanning {data.memberCount} member wallet{data.memberCount === 1 ? "" : "s"}
              {data.collections.length > 0 && (
                <>
                  {" · "}
                  {data.collections.length} collection
                  {data.collections.length === 1 ? "" : "s"}
                </>
              )}
            </>
          ) : undefined
        }
        aside={
          <div className="flex flex-col items-start sm:items-end gap-2">
            {data?.lastUpdated && (
              <p className="overline m-0 text-foreground/45" style={{ fontSize: 10 }}>
                Last updated: {formatTimestamp(data.lastUpdated)}
                {data.cached && " (cached)"}
              </p>
            )}
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing || loading}
              className={pillOutline}
            >
              {refreshing ? "Refreshing…" : "Refresh data"}
            </button>
          </div>
        }
      />

      {/* Loading state */}
      {loading && (
        <div className="grid gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className={`${paperCard} h-[300px] animate-pulse`} />
          ))}
        </div>
      )}

      {/* Error state */}
      {!loading && error && (
        <div className={`${paperCard} p-10 text-center grid justify-items-center gap-4`}>
          <p className="text-base text-destructive m-0">{error}</p>
          <button type="button" onClick={fetchData} className={pillInk}>
            Try again
          </button>
        </div>
      )}

      {/* Collections grid */}
      {!loading && !error && data && (
        <>
          {data.collections.length === 0 ? (
            <EmptyState title="No collections with member holders found.">
              {data.memberCount === 0
                ? "No members have connected wallets yet."
                : "Members may not hold any of the tracked collections."}
            </EmptyState>
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
    </EditorialPage>
  );
}
