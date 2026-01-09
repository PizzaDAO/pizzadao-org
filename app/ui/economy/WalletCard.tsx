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
      <div className="p-6 bg-gray-800 rounded-lg animate-pulse">
        <div className="h-6 bg-gray-700 rounded w-1/3 mb-4"></div>
        <div className="h-10 bg-gray-700 rounded w-1/2"></div>
      </div>
    );
  }

  if (error && !balance) {
    return (
      <div className="p-6 bg-red-900/20 border border-red-500 rounded-lg">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="p-6 bg-gray-800 rounded-lg">
      <h2 className="text-xl font-bold mb-4">Your Wallet</h2>

      {error && (
        <div className="mb-4 p-3 bg-red-900/20 border border-red-500 rounded text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="text-center p-4 bg-gray-700 rounded">
          <p className="text-sm text-gray-400">Wallet</p>
          <p className="text-2xl font-bold text-green-400">
            {balance?.formatted.wallet}
          </p>
        </div>
        <div className="text-center p-4 bg-gray-700 rounded">
          <p className="text-sm text-gray-400">Bank</p>
          <p className="text-2xl font-bold text-blue-400">
            {balance?.formatted.bank}
          </p>
        </div>
        <div className="text-center p-4 bg-gray-700 rounded">
          <p className="text-sm text-gray-400">Total</p>
          <p className="text-2xl font-bold text-yellow-400">
            {balance?.formatted.total}
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        <input
          type="number"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="flex-1 px-4 py-2 bg-gray-700 rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
          disabled={actionLoading}
        />
        <button
          onClick={handleDeposit}
          disabled={actionLoading || !amount}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded font-medium transition"
        >
          Deposit
        </button>
        <button
          onClick={handleWithdraw}
          disabled={actionLoading || !amount}
          className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded font-medium transition"
        >
          Withdraw
        </button>
      </div>
    </div>
  );
}
