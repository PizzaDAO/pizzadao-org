"use client";

import React, { useState } from "react";

type TransferFormProps = {
  onSuccess?: () => void;
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
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.18)",
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box",
  };
}

function btn(disabled?: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: "12px 16px",
    borderRadius: 10,
    border: "none",
    fontWeight: 650,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    background: "black",
    color: "white",
  };
}

export function TransferForm({ onSuccess }: TransferFormProps) {
  const [toUserId, setToUserId] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!toUserId || !amount) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/api/economy/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toUserId,
          amount: Number(amount),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSuccess(data.message);
      setToUserId("");
      setAmount("");
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transfer failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={card()}>
      <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 16, marginTop: 0 }}>Send $PEP</h2>

      {error && (
        <div style={{ marginBottom: 16, padding: 12, background: "rgba(255,0,0,0.05)", borderRadius: 8, color: "#c00", fontSize: 14 }}>
          {error}
        </div>
      )}

      {success && (
        <div style={{ marginBottom: 16, padding: 12, background: "rgba(0,200,0,0.08)", borderRadius: 8, color: "#16a34a", fontSize: 14 }}>
          {success}
        </div>
      )}

      <form onSubmit={handleTransfer} style={{ display: "grid", gap: 16 }}>
        <div>
          <label style={{ display: "block", fontSize: 13, opacity: 0.6, marginBottom: 6 }}>
            Recipient Discord ID
          </label>
          <input
            type="text"
            placeholder="Enter Discord user ID"
            value={toUserId}
            onChange={(e) => setToUserId(e.target.value)}
            style={input()}
            disabled={loading}
          />
        </div>

        <div>
          <label style={{ display: "block", fontSize: 13, opacity: 0.6, marginBottom: 6 }}>Amount</label>
          <input
            type="number"
            placeholder="Amount to send"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={input()}
            disabled={loading}
            min="1"
          />
        </div>

        <button
          type="submit"
          disabled={loading || !toUserId || !amount}
          style={btn(loading || !toUserId || !amount)}
        >
          {loading ? "Sending..." : "Send $PEP"}
        </button>
      </form>
    </div>
  );
}
