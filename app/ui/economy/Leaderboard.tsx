"use client";

import React, { useState, useEffect } from "react";

type LeaderboardEntry = {
  rank: number;
  userId: string;
  wallet: number;
  bank: number;
  total: number;
  formatted: string;
};

export function Leaderboard() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const res = await fetch("/api/economy/leaderboard");
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to fetch leaderboard");
        setEntries(data.leaderboard);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    fetchLeaderboard();
  }, []);

  if (loading) {
    return (
      <div className="p-6 bg-gray-800 rounded-lg">
        <h2 className="text-xl font-bold mb-4">Leaderboard</h2>
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 bg-gray-700 rounded animate-pulse"></div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-900/20 border border-red-500 rounded-lg">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  const getRankStyle = (rank: number) => {
    switch (rank) {
      case 1:
        return "bg-yellow-500/20 border-yellow-500";
      case 2:
        return "bg-gray-400/20 border-gray-400";
      case 3:
        return "bg-amber-600/20 border-amber-600";
      default:
        return "bg-gray-700 border-gray-600";
    }
  };

  const getRankEmoji = (rank: number) => {
    switch (rank) {
      case 1:
        return "🥇";
      case 2:
        return "🥈";
      case 3:
        return "🥉";
      default:
        return `#${rank}`;
    }
  };

  return (
    <div className="p-6 bg-gray-800 rounded-lg">
      <h2 className="text-xl font-bold mb-4">Leaderboard</h2>

      {entries.length === 0 ? (
        <p className="text-gray-400 text-center py-8">No entries yet</p>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <div
              key={entry.userId}
              className={`flex items-center justify-between p-3 rounded border ${getRankStyle(
                entry.rank
              )}`}
            >
              <div className="flex items-center gap-3">
                <span className="text-lg font-bold w-8">
                  {getRankEmoji(entry.rank)}
                </span>
                <span className="text-gray-300 font-mono text-sm">
                  {entry.userId.slice(0, 8)}...
                </span>
              </div>
              <span className="text-lg font-bold text-green-400">
                {entry.formatted}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
