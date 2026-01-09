"use client";

import React, { useState } from "react";

type TransferFormProps = {
  onSuccess?: () => void;
};

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
    <div className="p-6 bg-gray-800 rounded-lg">
      <h2 className="text-xl font-bold mb-4">Send $PEP</h2>

      {error && (
        <div className="mb-4 p-3 bg-red-900/20 border border-red-500 rounded text-red-400 text-sm">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 p-3 bg-green-900/20 border border-green-500 rounded text-green-400 text-sm">
          {success}
        </div>
      )}

      <form onSubmit={handleTransfer} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">
            Recipient Discord ID
          </label>
          <input
            type="text"
            placeholder="Enter Discord user ID"
            value={toUserId}
            onChange={(e) => setToUserId(e.target.value)}
            className="w-full px-4 py-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
            disabled={loading}
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Amount</label>
          <input
            type="number"
            placeholder="Amount to send"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full px-4 py-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
            disabled={loading}
            min="1"
          />
        </div>

        <button
          type="submit"
          disabled={loading || !toUserId || !amount}
          className="w-full px-4 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded font-medium transition"
        >
          {loading ? "Sending..." : "Send $PEP"}
        </button>
      </form>
    </div>
  );
}
