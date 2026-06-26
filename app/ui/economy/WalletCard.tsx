"use client";

// app/ui/economy/WalletCard.tsx
//
// capricciosa-35929 — Editorial restyle. Butter-tinted paper-soft surface,
// big numeric balance in display font, handwritten "ascertained" / "balance"
// margin annotations like a hand-stamped ledger entry. API contract
// unchanged — still calls GET /api/economy/balance.
//
// anchovy-67435 (Restyle Phase 4d): migrated off legacy `--color-*` aliases.

import React, { useState, useEffect } from "react";
import { PepAmount } from "./PepIcon";

type Balance = {
  balance: number;
  formatted: string;
};

export function WalletCard() {
  const [balance, setBalance] = useState<Balance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBalance = async () => {
    try {
      const res = await fetch("/api/economy/balance");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch balance");
      setBalance(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBalance();
  }, []);

  if (loading) {
    return (
      <div
        className="paper-soft relative overflow-hidden rounded-[24px] border"
        style={{
          background: "hsl(var(--butter) / 0.14)",
          borderColor: "hsl(var(--rule-warm) / 0.55)",
          boxShadow: "var(--shadow-soft)",
          minHeight: 200,
        }}
      />
    );
  }

  if (error && !balance) {
    return (
      <div
        className="paper-soft relative overflow-hidden rounded-[24px] border p-6"
        style={{
          background: "hsl(var(--tomato) / 0.08)",
          borderColor: "hsl(var(--tomato) / 0.30)",
          boxShadow: "var(--shadow-soft)",
        }}
      >
        <p className="relative" style={{ color: "hsl(var(--tomato))", margin: 0 }}>
          {error}
        </p>
      </div>
    );
  }

  return (
    <div
      className="paper-soft relative overflow-hidden rounded-[24px] border p-6 md:p-7"
      style={{
        background: "hsl(var(--butter) / 0.14)",
        borderColor: "hsl(var(--rule-warm) / 0.55)",
        boxShadow: "var(--shadow-soft)",
      }}
    >
      <div className="relative flex items-start justify-between gap-4">
        <p className="overline text-tomato">§ ··· Your wallet</p>
        <span
          className="handwritten -rotate-[6deg]"
          style={{
            fontSize: 15,
            color: "hsl(var(--foreground) / 0.55)",
          }}
        >
          ascertained
        </span>
      </div>

      {error && (
        <div
          className="relative mt-3"
          style={{
            padding: 12,
            background: "hsl(var(--tomato) / 0.08)",
            borderRadius: "var(--radius)",
            color: "hsl(var(--tomato))",
            fontSize: 14,
            border: "1px solid hsl(var(--tomato) / 0.30)",
          }}
        >
          {error}
        </div>
      )}

      <div className="relative mt-6 flex items-end justify-between gap-4">
        <div
          className="font-[family-name:var(--font-display)] font-black tracking-[-0.025em] text-foreground"
          style={{
            fontSize: "clamp(2.75rem, 7vw, 4.25rem)",
            lineHeight: 0.92,
          }}
        >
          <PepAmount amount={balance?.balance ?? 0} size={42} />
        </div>
        <span
          className="handwritten rotate-[4deg] pb-2"
          style={{
            fontSize: 17,
            color: "hsl(var(--tomato))",
            whiteSpace: "nowrap",
          }}
        >
          balance
        </span>
      </div>

      <div className="rule-warm relative mt-5" />

      <p className="ui relative mt-3 text-[10px] uppercase tracking-[0.28em] text-foreground/55">
        PEP available · ledger entry 01
      </p>
    </div>
  );
}
