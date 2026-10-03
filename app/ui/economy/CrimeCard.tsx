"use client";

// app/ui/economy/CrimeCard.tsx
//
// "Commit a crime": UnbelievaBoat's /crime on the web. Calls
// POST /api/economy/crime (live only with PEP_CRIME_ENABLED=1; the /pep page
// renders this card only when /api/economy/features says crime is on) and
// shows the outcome plus a countdown while on cooldown.

import React, { useEffect, useState } from "react";
import { PepAmount } from "./PepIcon";

type CrimeOutcome =
  | { outcome: "success"; amount: number; balance: number }
  | { outcome: "fined"; amount: number; finePercent: number; balance: number };

export function useCountdown(readyAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!readyAt) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [readyAt]);
  return readyAt ? Math.max(0, Math.ceil((readyAt - now) / 1000)) : 0;
}

export const cardSurface: React.CSSProperties = {
  background: "hsl(var(--card))",
  borderColor: "hsl(var(--rule-warm) / 0.55)",
  boxShadow: "var(--shadow-soft)",
};

export const primaryButton = (disabled: boolean): React.CSSProperties => ({
  background: disabled ? "hsl(var(--muted))" : "hsl(var(--tomato))",
  color: disabled ? "hsl(var(--muted-foreground))" : "hsl(var(--cream))",
  border: `1px solid ${disabled ? "hsl(var(--rule-warm) / 0.55)" : "hsl(var(--tomato))"}`,
  cursor: disabled ? "not-allowed" : "pointer",
});

export function CrimeCard({ onResult }: { onResult?: () => void }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CrimeOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readyAt, setReadyAt] = useState<number | null>(null);
  const wait = useCountdown(readyAt);

  const commit = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/economy/crime", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429 && data.readyAt) {
        setReadyAt(new Date(data.readyAt).getTime());
        return;
      }
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      setResult(data as CrimeOutcome);
      onResult?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const disabled = loading || wait > 0;

  return (
    <div className="paper-soft relative overflow-hidden rounded-[24px] border p-6 md:p-7" style={cardSurface}>
      <div className="relative flex items-start justify-between gap-4">
        <p className="overline text-tomato">§ ··· Crime</p>
        <span className="handwritten -rotate-[5deg]" style={{ fontSize: 14, color: "hsl(var(--foreground) / 0.55)" }}>
          fuhgeddaboudit
        </span>
      </div>
      <h2
        className="font-[family-name:var(--font-display)] relative mt-2 font-black tracking-[-0.02em] text-foreground"
        style={{ fontSize: "clamp(1.4rem, 3vw, 1.9rem)", lineHeight: 0.95 }}
      >
        Commit a crime
      </h2>
      <p className="relative mt-2 text-sm" style={{ color: "hsl(var(--muted-foreground))" }}>
        Big payday or a fine off your wallet. Your call.
      </p>

      <button
        type="button"
        onClick={commit}
        disabled={disabled}
        className="btn-pill-lg relative mt-4 w-full"
        style={primaryButton(disabled)}
      >
        {loading ? "Casing the joint..." : wait > 0 ? `Lay low for ${wait}s` : "Commit a crime"}
      </button>

      {error && (
        <p className="relative mt-3 text-sm" role="alert" style={{ color: "hsl(var(--tomato))" }}>
          {error}
        </p>
      )}
      {result && (
        <div
          className="relative mt-4"
          role="status"
          style={{
            padding: 12,
            borderRadius: 14,
            background: result.outcome === "success" ? "hsl(var(--butter) / 0.18)" : "hsl(var(--tomato) / 0.08)",
            border: `1px solid ${result.outcome === "success" ? "hsl(var(--butter) / 0.6)" : "hsl(var(--tomato) / 0.3)"}`,
          }}
        >
          {result.outcome === "success" ? (
            <span className="flex flex-wrap items-center gap-1">
              It paid off: <PepAmount amount={result.amount} size={14} />
            </span>
          ) : (
            <span className="flex flex-wrap items-center gap-1">
              Caught! Fined {result.finePercent}%: <PepAmount amount={result.amount} size={14} />
            </span>
          )}
        </div>
      )}
    </div>
  );
}
