"use client";

// app/ui/economy/WalletCard.tsx
//
// anchovy-67435 (Restyle Phase 4d): migrated off legacy `--color-*` aliases
// onto the new semantic HSL tokens and the shared `card()` primitive. Big PEP
// balance now rendered in butter accent + Asap Condensed display font to match
// pizzadao.org. See plans/site-restyle-pizzadao-org.md.

import React, { useState, useEffect } from "react";
import { PepAmount } from "./PepIcon";
import { card } from "../shared-styles";

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
      <div style={{ ...card(), height: 140, background: "hsl(var(--muted))" }} />
    );
  }

  if (error && !balance) {
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
      <h2
        style={{
          fontFamily: "var(--font-display), var(--font-sans), system-ui, sans-serif",
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: "-0.01em",
          margin: 0,
          color: "hsl(var(--foreground))",
        }}
      >
        Your balance
      </h2>

      {error && (
        <div
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

      <div
        style={{
          textAlign: "center",
          padding: "28px 20px",
          background: "hsl(var(--background))",
          border: "1px solid hsl(var(--rule) / 0.12)",
          borderRadius: "var(--radius)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-display), var(--font-sans), system-ui, sans-serif",
            fontSize: 48,
            fontWeight: 800,
            lineHeight: 1,
            letterSpacing: "-0.02em",
            color: "hsl(var(--tomato))",
          }}
        >
          <PepAmount amount={balance?.balance ?? 0} size={36} />
        </div>
        <div
          style={{
            marginTop: 8,
            fontSize: 12,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "hsl(var(--muted-foreground))",
          }}
        >
          PEP available
        </div>
      </div>
    </div>
  );
}
