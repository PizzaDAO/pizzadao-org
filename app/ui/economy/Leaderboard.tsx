"use client";

// app/ui/economy/Leaderboard.tsx
//
// capricciosa-35929 — Editorial restyle: ink card, `§ ··· Leaderboard`
// overline, display headline, editorial rank numbers (01, 02, 03). Calls GET
// /api/economy/leaderboard and renders the first 3 entries via UserLink
// (preserves the spinach-65462 memberId resolution).
//
// /pep fixes: the rows used to be rotated "file cards" with light washes
// (butter / cream-warm / tomato) under `--foreground` text. On the ink card
// that put dark text on a dark row in light mode (names of #1 and #3
// unreadable) and cream text on a cream row in dark mode (#2 unreadable), and
// in the 2-up grid the name column collapsed to 0px, the balance was clipped
// ("4,2") and the margin notes overlapped the next row. Rows are now flat
// ranked lines on the ink surface with cream text in both themes, a
// truncating name and a plain "4,200 $PEP" amount. `refreshKey` refetches
// after a wallet change.
//
// anchovy-67435 (Restyle Phase 4d): semantic HSL tokens.

import React, { useState, useEffect } from "react";
import { formatPep } from "./PepIcon";
import { UserLink } from "../UserLink";

type LeaderboardEntry = {
  rank: number;
  userId: string;
  // spinach-65462: server-resolved sheet member ID (small integer string)
  // used for the /profile/{memberId} link. Null when no matching sheet row
  // exists for the Discord ID.
  memberId: string | null;
  balance: number;
  formatted: string;
};

// Rank accents on the ink surface (same in light and dark: --ink and --cream
// are raw palette tokens that do not flip with the theme).
const RANK_ACCENT = ["hsl(var(--butter))", "hsl(var(--cream) / 0.85)", "hsl(var(--tomato))"];

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

export function Leaderboard({ refreshKey = 0 }: { refreshKey?: number }) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const res = await fetch("/api/economy/leaderboard", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to fetch leaderboard");
        setEntries(data.leaderboard.slice(0, 3));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    fetchLeaderboard();
  }, [refreshKey]);

  const shell: React.CSSProperties = {
    background: "hsl(var(--ink))",
    color: "hsl(var(--cream))",
    borderColor: "hsl(var(--cream) / 0.12)",
    boxShadow: "var(--shadow-lifted)",
  };

  const header = (
    <>
      <div className="relative flex items-baseline justify-between gap-3">
        <p className="overline m-0" style={{ color: "hsl(var(--butter))" }}>
          § ··· Leaderboard
        </p>
        <span
          className="handwritten -rotate-[5deg] whitespace-nowrap"
          style={{ fontSize: 14, color: "hsl(var(--cream) / 0.55)" }}
        >
          the top three
        </span>
      </div>
      <h2
        className="font-[family-name:var(--font-display)] relative mt-2 mb-0 font-black tracking-[-0.02em]"
        style={{ fontSize: "clamp(1.6rem, 3.5vw, 2.25rem)", lineHeight: 0.95, color: "hsl(var(--cream))" }}
      >
        Top earners
      </h2>
    </>
  );

  if (loading) {
    return (
      <section
        aria-busy="true"
        className="ink-spread paper-soft paper-soft-dark relative overflow-hidden rounded-[24px] border p-6 md:p-7"
        style={shell}
      >
        {header}
        <div className="relative mt-5 grid gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[52px] rounded-[14px]" style={{ background: "hsl(var(--cream) / 0.08)" }} />
          ))}
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section
        className="ink-spread paper-soft paper-soft-dark relative overflow-hidden rounded-[24px] border p-6 md:p-7"
        style={{ ...shell, borderColor: "hsl(var(--tomato) / 0.45)" }}
      >
        {header}
        <p className="relative mt-4 mb-0" role="alert" style={{ color: "hsl(var(--cream) / 0.8)" }}>
          {error}
        </p>
      </section>
    );
  }

  return (
    <section
      className="ink-spread paper-soft paper-soft-dark relative overflow-hidden rounded-[24px] border p-6 md:p-7"
      style={shell}
      data-testid="pep-leaderboard"
    >
      {header}

      {entries.length === 0 ? (
        <p className="relative mt-6 mb-0 py-6 text-center" style={{ color: "hsl(var(--cream) / 0.6)" }}>
          No entries yet
        </p>
      ) : (
        <ol className="relative mt-5 mb-0 grid list-none gap-2 p-0">
          {entries.map((entry, idx) => {
            const accent = RANK_ACCENT[idx] ?? "hsl(var(--cream) / 0.6)";
            const top = idx === 0;
            return (
              <li
                key={entry.userId}
                className="flex min-w-0 items-center gap-3 rounded-[14px] border px-3 py-2.5"
                style={{
                  background: top ? "hsl(var(--butter) / 0.12)" : "hsl(var(--cream) / 0.05)",
                  borderColor: top ? "hsl(var(--butter) / 0.45)" : "hsl(var(--cream) / 0.12)",
                }}
              >
                <span
                  aria-label={`Rank ${entry.rank}`}
                  className="font-[family-name:var(--font-display)] w-[2ch] shrink-0 font-black tabular-nums tracking-[-0.04em]"
                  style={{ fontSize: "1.75rem", lineHeight: 1, color: accent }}
                >
                  {pad2(entry.rank)}
                </span>
                <span
                  className="font-[family-name:var(--font-display)] block min-w-0 flex-1 truncate font-black tracking-tight"
                  style={{ fontSize: 15, lineHeight: 1.2, color: "hsl(var(--cream))" }}
                >
                  <UserLink
                    discordId={entry.userId}
                    memberId={entry.memberId}
                    style={{ fontSize: "inherit", color: "hsl(var(--cream))" }}
                  />
                </span>
                <span
                  className="font-[family-name:var(--font-display)] shrink-0 whitespace-nowrap font-black tabular-nums tracking-tight"
                  style={{ fontSize: 15, color: top ? "hsl(var(--butter))" : "hsl(var(--cream) / 0.9)" }}
                >
                  {formatPep(entry.balance)}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <p
        className="relative mt-5 mb-0 text-[10px] font-semibold uppercase tracking-[0.24em]"
        style={{ color: "hsl(var(--cream) / 0.5)" }}
      >
        Ranked by $PEP balance
      </p>
    </section>
  );
}
