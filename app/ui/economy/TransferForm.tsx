"use client";

// app/ui/economy/TransferForm.tsx
//
// anchovy-67435 (Restyle Phase 4d): migrated off legacy `--color-*` aliases
// onto the shared `card()`, `btn("accent")`, and `input()` primitives + the
// shared `Field` label so the form matches the pizzadao.org look (cream bg,
// tomato focus ring, tomato CTA). See plans/site-restyle-pizzadao-org.md.

import React, { useState } from "react";
import { PepIcon } from "./PepIcon";
import { card, btn, input } from "../shared-styles";
import { Field } from "../onboarding/Field";

type TransferFormProps = {
  onSuccess?: () => void;
};

const DISPLAY_FONT =
  "var(--font-display), var(--font-sans), system-ui, sans-serif";

function focusableInputProps() {
  // Add the tomato focus ring on focus / remove on blur. We can't use
  // pseudo-classes from inline styles, so wire it via onFocus/onBlur.
  return {
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => {
      e.currentTarget.style.borderColor = "hsl(var(--ring))";
      e.currentTarget.style.boxShadow = "0 0 0 3px hsl(var(--ring) / 0.20)";
    },
    onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
      e.currentTarget.style.borderColor = "hsl(var(--rule) / 0.22)";
      e.currentTarget.style.boxShadow = "none";
    },
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

  const disabled = loading || !toUserId || !amount;

  return (
    <div style={card()}>
      <h2
        style={{
          fontFamily: DISPLAY_FONT,
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: "-0.01em",
          margin: 0,
          display: "flex",
          alignItems: "center",
          gap: 8,
          color: "hsl(var(--foreground))",
        }}
      >
        Send <PepIcon size={20} />
      </h2>

      {error && (
        <div
          style={{
            padding: 12,
            background: "hsl(var(--tomato) / 0.08)",
            border: "1px solid hsl(var(--tomato) / 0.30)",
            borderRadius: "var(--radius)",
            color: "hsl(var(--tomato))",
            fontSize: 14,
          }}
        >
          {error}
        </div>
      )}

      {success && (
        <div
          style={{
            padding: 12,
            background: "hsl(142 71% 35% / 0.10)",
            border: "1px solid hsl(142 71% 35% / 0.30)",
            borderRadius: "var(--radius)",
            color: "hsl(142 71% 28%)",
            fontSize: 14,
          }}
        >
          {success}
        </div>
      )}

      <form onSubmit={handleTransfer} style={{ display: "grid", gap: 16 }}>
        <Field label="Recipient Discord ID">
          <input
            type="text"
            placeholder="Enter Discord user ID"
            value={toUserId}
            onChange={(e) => setToUserId(e.target.value)}
            style={input()}
            disabled={loading}
            {...focusableInputProps()}
          />
        </Field>

        <Field label="Amount">
          <input
            type="number"
            placeholder="Amount to send"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={input()}
            disabled={loading}
            min="1"
            {...focusableInputProps()}
          />
        </Field>

        <button
          type="submit"
          disabled={disabled}
          style={{ ...btn("accent", disabled), width: "100%", padding: "12px 16px" }}
        >
          {loading ? (
            "Sending..."
          ) : (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              Send <PepIcon size={14} />
            </span>
          )}
        </button>
      </form>
    </div>
  );
}
