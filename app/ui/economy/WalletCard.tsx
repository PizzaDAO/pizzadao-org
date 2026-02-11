"use client";

import React, { useState, useEffect } from "react";
import { PepAmount } from "./PepIcon";

type Balance = {
  balance: number;
  formatted: string;
};

function card(): React.CSSProperties {
  return {
    border: '1px solid var(--color-border)',
    borderRadius: 14,
    padding: 20,
    boxShadow: 'var(--shadow-card)',
    background: 'var(--color-surface)',
  };
}

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
      <div style={{ ...card(), height: 120, background: 'var(--color-surface-hover)' }} />
    );
  }

  if (error && !balance) {
    return (
      <div style={{ ...card(), background: "rgba(255,0,0,0.05)", borderColor: "rgba(255,0,0,0.3)" }}>
        <p style={{ color: "#c00" }}>{error}</p>
      </div>
    );
  }

  return (
    <div style={card()}>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16, marginTop: 0 }}>Your Balance</h2>

      {error && (
        <div style={{ marginBottom: 16, padding: 12, background: "rgba(255,0,0,0.05)", borderRadius: 8, color: "#c00", fontSize: 14 }}>
          {error}
        </div>
      )}

      <div style={{ textAlign: "center", padding: 20, background: 'var(--color-page-bg)', borderRadius: 10 }}>
        <div style={{ fontSize: 32, fontWeight: 700, margin: 0, color: "#16a34a" }}>
          <PepAmount amount={balance?.balance ?? 0} size={32} />
        </div>
      </div>
    </div>
  );
}
