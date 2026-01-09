"use client";

import React, { useState, useEffect } from "react";

type Balance = {
  wallet: number;
  bank: number;
  total: number;
  formatted: {
    wallet: string;
    bank: string;
    total: string;
  };
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

function input(): React.CSSProperties {
  return {
    flex: 1,
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.18)",
    fontSize: 14,
    outline: "none",
  };
}

function btn(kind: "primary" | "secondary", disabled?: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.18)",
    fontWeight: 650,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    fontSize: 14,
  };
  if (kind === "primary") return { ...base, background: "black", color: "white", borderColor: "black" };
  return { ...base, background: "white", color: "black" };
}

export function WalletCard() {
  const [balance, setBalance] = useState<Balance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [amount, setAmount] = useState("");

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

  const handleDeposit = async () => {
    if (!amount || isNaN(Number(amount))) return;
    setActionLoading(true);
    try {
      const res = await fetch("/api/economy/deposit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(amount) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAmount("");
      fetchBalance();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deposit failed");
    } finally {
      setActionLoading(false);
    }
  };

  const handleWithdraw = async () => {
    if (!amount || isNaN(Number(amount))) return;
    setActionLoading(true);
    try {
      const res = await fetch("/api/economy/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(amount) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setAmount("");
      fetchBalance();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Withdraw failed");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ ...card(), height: 180, background: "rgba(0,0,0,0.04)" }} />
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
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16, marginTop: 0 }}>Your Wallet</h2>

      {error && (
        <div style={{ marginBottom: 16, padding: 12, background: "rgba(255,0,0,0.05)", borderRadius: 8, color: "#c00", fontSize: 14 }}>
          {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div style={{ textAlign: "center", padding: 12, background: "#fafafa", borderRadius: 10 }}>
          <p style={{ fontSize: 12, opacity: 0.6, margin: 0 }}>Wallet</p>
          <p style={{ fontSize: 20, fontWeight: 700, margin: "4px 0 0", color: "#16a34a" }}>
            {balance?.formatted.wallet}
          </p>
        </div>
        <div style={{ textAlign: "center", padding: 12, background: "#fafafa", borderRadius: 10 }}>
          <p style={{ fontSize: 12, opacity: 0.6, margin: 0 }}>Bank</p>
          <p style={{ fontSize: 20, fontWeight: 700, margin: "4px 0 0", color: "#2563eb" }}>
            {balance?.formatted.bank}
          </p>
        </div>
        <div style={{ textAlign: "center", padding: 12, background: "#fafafa", borderRadius: 10 }}>
          <p style={{ fontSize: 12, opacity: 0.6, margin: 0 }}>Total</p>
          <p style={{ fontSize: 20, fontWeight: 700, margin: "4px 0 0", color: "#ca8a04" }}>
            {balance?.formatted.total}
          </p>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="number"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={input()}
          disabled={actionLoading}
        />
        <button
          onClick={handleDeposit}
          disabled={actionLoading || !amount}
          style={btn("secondary", actionLoading || !amount)}
        >
          Deposit
        </button>
        <button
          onClick={handleWithdraw}
          disabled={actionLoading || !amount}
          style={btn("secondary", actionLoading || !amount)}
        >
          Withdraw
        </button>
      </div>
    </div>
  );
}
