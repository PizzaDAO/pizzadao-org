"use client";

import React, { useState, useEffect } from "react";
import { PepAmount } from "./PepIcon";

type LeaderboardEntry = {
  rank: number;
  userId: string;
  balance: number;
  formatted: string;
};

function card(): React.CSSProperties {
  return {
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: 14,
    padding: 20,
    boxShadow: "0 8px 30px rgba(0,0,0,0.06)",
    background: "white",
  };
}

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
        setEntries(data.leaderboard.slice(0, 3));
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
      <div style={card()}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16, marginTop: 0 }}>Leaderboard</h2>
        <div style={{ display: "grid", gap: 8 }}>
          {[...Array(3)].map((_, i) => (
            <div key={i} style={{ height: 48, background: "rgba(0,0,0,0.04)", borderRadius: 10 }} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ ...card(), background: "rgba(255,0,0,0.05)", borderColor: "rgba(255,0,0,0.3)" }}>
        <p style={{ color: "#c00" }}>{error}</p>
      </div>
    );
  }

  const getRankStyle = (rank: number): React.CSSProperties => {
    switch (rank) {
      case 1:
        return { background: "rgba(234,179,8,0.1)", borderColor: "rgba(234,179,8,0.4)" };
      case 2:
        return { background: "rgba(156,163,175,0.1)", borderColor: "rgba(156,163,175,0.4)" };
      case 3:
        return { background: "rgba(217,119,6,0.1)", borderColor: "rgba(217,119,6,0.4)" };
      default:
        return { background: "#fafafa", borderColor: "rgba(0,0,0,0.1)" };
    }
  };

  const getRankEmoji = (rank: number) => {
    switch (rank) {
      case 1:
        return "1st";
      case 2:
        return "2nd";
      case 3:
        return "3rd";
      default:
        return `#${rank}`;
    }
  };

  return (
    <div style={card()}>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16, marginTop: 0 }}>Leaderboard</h2>

      {entries.length === 0 ? (
        <p style={{ opacity: 0.5, textAlign: "center", padding: "32px 0" }}>No entries yet</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {entries.map((entry) => (
            <div
              key={entry.userId}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: 12,
                borderRadius: 10,
                border: "1px solid",
                ...getRankStyle(entry.rank),
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontWeight: 700, width: 32 }}>
                  {getRankEmoji(entry.rank)}
                </span>
                <span style={{ fontFamily: "monospace", fontSize: 13, opacity: 0.7 }}>
                  {entry.userId.slice(0, 8)}...
                </span>
              </div>
              <span style={{ fontWeight: 700, color: "#16a34a" }}>
                <PepAmount amount={entry.balance} size={14} />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
