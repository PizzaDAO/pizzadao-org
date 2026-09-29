"use client";

// app/ui/economy/Leaderboard.tsx
//
// capricciosa-35929 — Editorial restyle. Ink-bottom card surface with
// editorial rank numbers (01, 02, 03) in Asap Condensed, rotated row
// entries like a family-file card. Top 3 carry butter / cream / tomato
// accent washes. API contract unchanged — still calls GET
// /api/economy/leaderboard and renders the first 3 entries via UserLink
// (preserves the spinach-65462 memberId resolution).
//
// anchovy-67435 (Restyle Phase 4d): semantic HSL tokens.

import React, { useState, useEffect } from "react";
import { PepAmount } from "./PepIcon";
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

type RowPersona = {
  rotation: number;
  background: string;
  borderColor: string;
  accent: string;
  margin: string;
};

const ROW_PERSONAS: RowPersona[] = [
  {
    rotation: -0.9,
    background: "hsl(var(--butter) / 0.22)",
    borderColor: "hsl(var(--butter) / 0.6)",
    accent: "hsl(var(--ink))",
    margin: "the don",
  },
  {
    rotation: 0.7,
    background: "hsl(var(--cream-warm) / 1)",
    borderColor: "hsl(var(--rule-warm) / 0.6)",
    accent: "hsl(var(--ink))",
    margin: "consigliere",
  },
  {
    rotation: -0.4,
    background: "hsl(var(--tomato) / 0.10)",
    borderColor: "hsl(var(--tomato) / 0.42)",
    accent: "hsl(var(--tomato))",
    margin: "earner",
  },
];

const DEFAULT_PERSONA: RowPersona = {
  rotation: 0,
  background: "hsl(var(--card))",
  borderColor: "hsl(var(--rule-warm) / 0.45)",
  accent: "hsl(var(--muted-foreground))",
  margin: "",
};

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
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

  const shell: React.CSSProperties = {
    background: "hsl(var(--ink))",
    color: "hsl(var(--cream))",
    borderColor: "hsl(var(--cream) / 0.12)",
    boxShadow: "var(--shadow-lifted)",
  };

  if (loading) {
    return (
      <div
        className="ink-spread paper-soft paper-soft-dark relative overflow-hidden rounded-[24px] border p-6 md:p-7"
        style={shell}
      >
        <p className="overline relative" style={{ color: "hsl(var(--butter))" }}>
          § ··· Leaderboard
        </p>
        <div className="relative mt-5 grid gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              style={{
                height: 60,
                background: "hsl(var(--cream) / 0.08)",
                borderRadius: 14,
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
        className="ink-spread paper-soft paper-soft-dark relative overflow-hidden rounded-[24px] border p-6"
        style={{
          ...shell,
          background: "hsl(var(--tomato) / 0.16)",
          borderColor: "hsl(var(--tomato) / 0.45)",
        }}
      >
        <p className="overline relative" style={{ color: "hsl(var(--butter))" }}>
          § ··· Leaderboard
        </p>
        <p
          className="relative mt-3"
          style={{ color: "hsl(var(--cream))", margin: 0 }}
        >
          {error}
        </p>
      </div>
    );
  }

  return (
    <div
      className="ink-spread paper-soft paper-soft-dark relative overflow-hidden rounded-[24px] border p-6 md:p-7"
      style={shell}
    >
      <div className="relative flex items-baseline justify-between gap-3">
        <p className="overline" style={{ color: "hsl(var(--butter))" }}>
          § ··· Leaderboard
        </p>
        <span
          className="handwritten -rotate-[5deg]"
          style={{
            fontSize: 14,
            color: "hsl(var(--cream) / 0.55)",
          }}
        >
          the top three
        </span>
      </div>

      <h2
        className="font-[family-name:var(--font-display)] relative mt-2 font-black tracking-[-0.02em]"
        style={{
          fontSize: "clamp(1.6rem, 3.5vw, 2.25rem)",
          lineHeight: 0.95,
          color: "hsl(var(--cream))",
        }}
      >
        Top earners
      </h2>

      {entries.length === 0 ? (
        <p
          className="relative mt-6 text-center"
          style={{
            color: "hsl(var(--cream) / 0.6)",
            padding: "24px 0",
            margin: 0,
          }}
        >
          No entries yet
        </p>
      ) : (
        <div className="relative mt-5 grid gap-3">
          {entries.map((entry, idx) => {
            const persona = ROW_PERSONAS[idx] ?? DEFAULT_PERSONA;
            return (
              <div
                key={entry.userId}
                className="grain relative overflow-hidden rounded-[16px] border transition-transform duration-500"
                style={{
                  transform: `rotate(${persona.rotation}deg)`,
                  background: persona.background,
                  borderColor: persona.borderColor,
                  boxShadow: "var(--shadow-soft)",
                  padding: "14px 16px",
                }}
              >
                <div className="relative flex items-center gap-4">
                  <span
                    className="font-[family-name:var(--font-display)] font-black tracking-[-0.04em] shrink-0"
                    style={{
                      fontSize: "clamp(2.25rem, 4.5vw, 3rem)",
                      lineHeight: 0.9,
                      color: persona.accent,
                      minWidth: "1.6em",
                    }}
                  >
                    {pad2(entry.rank)}
                  </span>

                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span
                      className="ui text-[10px] uppercase tracking-[0.24em]"
                      style={{ color: "hsl(var(--foreground) / 0.5)" }}
                    >
                      file no. {pad2(entry.rank)}
                    </span>
                    <span
                      className="font-[family-name:var(--font-display)] truncate font-black tracking-tight"
                      style={{
                        fontSize: "clamp(0.95rem, 1.6vw, 1.15rem)",
                        lineHeight: 1.1,
                        color: "hsl(var(--foreground))",
                      }}
                    >
                      <UserLink
                        discordId={entry.userId}
                        memberId={entry.memberId}
                        style={{
                          fontSize: "inherit",
                          color: "hsl(var(--foreground))",
                        }}
                      />
                    </span>
                  </div>

                  <span
                    className="font-[family-name:var(--font-display)] font-black tracking-tight whitespace-nowrap"
                    style={{
                      fontSize: "clamp(0.95rem, 1.7vw, 1.15rem)",
                      color: persona.accent,
                    }}
                  >
                    <PepAmount amount={entry.balance} size={14} />
                  </span>
                </div>

                {persona.margin && (
                  <span
                    aria-hidden
                    className="handwritten pointer-events-none absolute -bottom-1 right-3 -rotate-[5deg]"
                    style={{
                      fontSize: 14,
                      color: persona.accent,
                      opacity: 0.55,
                    }}
                  >
                    {persona.margin}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p
        className="ui relative mt-5 text-[10px] uppercase tracking-[0.24em]"
        style={{ color: "hsl(var(--cream) / 0.5)" }}
      >
        ledger · ranked by PEP balance
      </p>
    </div>
  );
}
