"use client";

// app/ui/economy/TransferForm.tsx
//
// capricciosa-35929 — Editorial restyle. Paper-soft surface with handwritten
// margin annotation, hairline rules between fields, `btn-pill-lg` accent
// send button. API contract unchanged — still POSTs /api/economy/transfer
// with the same { toUserId, amount } shape.
//
// anchovy-67435 (Restyle Phase 4d): semantic HSL tokens.

import React, { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { PepIcon } from "./PepIcon";
import { input } from "../shared-styles";
import { Field } from "../onboarding/Field";

type TransferFormProps = {
  onSuccess?: () => void;
};

function focusableInputProps() {
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
    <div
      className="paper-soft relative overflow-hidden rounded-[24px] border p-6 md:p-7"
      style={{
        background: "hsl(var(--card))",
        borderColor: "hsl(var(--rule-warm) / 0.55)",
        boxShadow: "var(--shadow-soft)",
      }}
    >
      <div className="relative flex items-start justify-between gap-4">
        <p className="overline text-tomato">§ ··· Send</p>
        <span
          className="handwritten -rotate-[6deg]"
          style={{
            fontSize: 15,
            color: "hsl(var(--foreground) / 0.55)",
          }}
        >
          on the books
        </span>
      </div>

      <h2
        className="font-[family-name:var(--font-display)] relative mt-2 flex items-center gap-2 font-black tracking-[-0.02em] text-foreground"
        style={{
          fontSize: "clamp(1.6rem, 3.5vw, 2.25rem)",
          lineHeight: 0.95,
        }}
      >
        Move <PepIcon size={28} />
      </h2>

      {error && (
        <div
          className="relative mt-4"
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
          className="relative mt-4"
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

      <form onSubmit={handleTransfer} className="relative mt-5 grid gap-4">
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

        <div className="rule-warm" />

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
          className="btn-pill-lg group mt-2 w-full"
          style={{
            background: "hsl(var(--tomato))",
            color: "hsl(var(--cream))",
            border: "1px solid hsl(var(--tomato))",
            boxShadow: disabled ? "none" : "var(--shadow-soft)",
          }}
        >
          {loading ? (
            "Sending..."
          ) : (
            <>
              Send <PepIcon size={14} />
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </>
          )}
        </button>
      </form>
    </div>
  );
}
