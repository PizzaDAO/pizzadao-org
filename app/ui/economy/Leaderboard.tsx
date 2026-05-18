"use client";

// app/ui/economy/Leaderboard.tsx
//
// anchovy-67435 (Restyle Phase 4d): migrated off legacy `--color-*` aliases
// onto the new semantic HSL tokens. Rank numbers rendered in Asap Condensed;
// top 3 highlighted in butter (1st) / ink (2nd) / tomato (3rd) per the
// pizzadao.org look. See plans/site-restyle-pizzadao-org.md.

import React, { useState, useEffect } from "react";
import { PepAmount } from "./PepIcon";
import { UserLink } from "../UserLink";
import { card } from "../shared-styles";

type LeaderboardEntry = {
  rank: number;
  userId: string;
  balance: number;
  formatted: string;
};

const DISPLAY_FONT =
  "var(--font-display), var(--font-sans), system-ui, sans-serif";

function rankAccent(rank: number): {
  background: string;
  borderColor: string;
  rankColor: string;
} {
  switch (rank) {
    case 1:
      return {
        background: "hsl(var(--butter) / 0.18)",
        borderColor: "hsl(var(--butter) / 0.55)",
        rankColor: "hsl(var(--ink))",
      };
    case 2:
      return {
        background: "hsl(var(--ink) / 0.06)",
        borderColor: "hsl(var(--ink) / 0.30)",
        rankColor: "hsl(var(--ink))",
      };
    case 3:
      return {
        background: "hsl(var(--tomato) / 0.10)",
        borderColor: "hsl(var(--tomato) / 0.35)",
        rankColor: "hsl(var(--tomato))",
      };
    default:
      return {
        background: "hsl(var(--background))",
        borderColor: "hsl(var(--rule) / 0.12)",
        rankColor: "hsl(var(--muted-foreground))",
      };
  }
}

function rankLabel(rank: number): string {
  if (rank === 1) return "1st";
  if (rank === 2) return "2nd";
  if (rank === 3) return "3rd";
  return `#${rank}`;
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

  const heading = (
    <h2
      style={{
        fontFamily: DISPLAY_FONT,
        fontSize: 22,
        fontWeight: 700,
        letterSpacing: "-0.01em",
        margin: 0,
        color: "hsl(var(--foreground))",
      }}
    >
      Leaderboard
    </h2>
  );

  if (loading) {
    return (
      <div style={card()}>
        {heading}
        <div style={{ display: "grid", gap: 8 }}>
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              style={{
                height: 52,
                background: "hsl(var(--muted))",
                borderRadius: "var(--radius)",
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          ...card(),
          background: "hsl(var(--tomato) / 0.08)",
          borderColor: "hsl(var(--tomato) / 0.30)",
        }}
      >
        <p style={{ color: "hsl(var(--tomato))", margin: 0 }}>{error}</p>
      </div>
    );
  }

  return (
    <div style={card()}>
      {heading}

      {entries.length === 0 ? (
        <p
          style={{
            color: "hsl(var(--muted-foreground))",
            textAlign: "center",
            padding: "32px 0",
            margin: 0,
          }}
        >
          No entries yet
        </p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {entries.map((entry) => {
            const accent = rankAccent(entry.rank);
            return (
              <div
                key={entry.userId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px 14px",
                  borderRadius: "var(--radius)",
                  border: `1px solid ${accent.borderColor}`,
                  background: accent.background,
                  transition: "background-color 150ms ease",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      fontFamily: DISPLAY_FONT,
                      fontSize: 22,
                      fontWeight: 800,
                      letterSpacing: "-0.02em",
                      color: accent.rankColor,
                      width: 36,
                      flexShrink: 0,
                    }}
                  >
                    {rankLabel(entry.rank)}
                  </span>
                  <UserLink
                    discordId={entry.userId}
                    style={{
                      fontSize: 14,
                      color: "hsl(var(--foreground))",
                    }}
                  />
                </div>
                <span
                  style={{
                    fontFamily: DISPLAY_FONT,
                    fontSize: 16,
                    fontWeight: 700,
                    color: "hsl(var(--tomato))",
                    textAlign: "right",
                  }}
                >
                  <PepAmount amount={entry.balance} size={14} />
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
