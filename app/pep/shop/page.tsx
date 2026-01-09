"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ShopGrid, InventoryList } from "../../ui/shop";
import { WalletCard } from "../../ui/economy";

type SessionData = {
  authenticated: boolean;
  discordId?: string;
  username?: string;
};

export default function ShopPage() {
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const res = await fetch("/api/me");
        const data = await res.json();
        setSession(data);
      } catch {
        setSession({ authenticated: false });
      } finally {
        setLoading(false);
      }
    };
    checkSession();
  }, []);

  const handlePurchase = () => {
    setRefreshKey((k) => k + 1);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-8">
        <div className="max-w-6xl mx-auto animate-pulse">
          <div className="h-8 bg-gray-700 rounded w-1/4 mb-8"></div>
          <div className="grid grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-40 bg-gray-700 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!session?.authenticated) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-8">
        <div className="max-w-md mx-auto text-center py-20">
          <h1 className="text-3xl font-bold mb-4">Shop</h1>
          <p className="text-gray-400 mb-8">
            Please log in with Discord to access the shop.
          </p>
          <Link
            href="/api/discord/login"
            className="inline-block px-6 py-3 bg-indigo-600 hover:bg-indigo-700 rounded-lg font-medium transition"
          >
            Login with Discord
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      <div className="max-w-6xl mx-auto">
        <header className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold">Shop</h1>
            <p className="text-gray-400">Spend your $PEP on items</p>
          </div>
          <nav className="flex gap-4">
            <Link
              href="/pep"
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded transition"
            >
              Wallet
            </Link>
            <Link
              href="/pep/jobs"
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded transition"
            >
              Jobs
            </Link>
          </nav>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            <h2 className="text-xl font-bold mb-4">Available Items</h2>
            <ShopGrid key={`shop-${refreshKey}`} onPurchase={handlePurchase} />
          </div>
          <div className="space-y-6">
            <WalletCard key={`wallet-${refreshKey}`} />
            <InventoryList key={`inv-${refreshKey}`} />
          </div>
        </div>
      </div>
    </div>
  );
}
