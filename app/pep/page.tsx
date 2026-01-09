"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { WalletCard, Leaderboard, TransferForm } from "../ui/economy";

type SessionData = {
  authenticated: boolean;
  discordId?: string;
  username?: string;
};

export default function PepDashboard() {
  const [session, setSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);

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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-8">
        <div className="max-w-6xl mx-auto">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-700 rounded w-1/3 mb-8"></div>
            <div className="h-64 bg-gray-700 rounded mb-4"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!session?.authenticated) {
    return (
      <div className="min-h-screen bg-gray-900 text-white p-8">
        <div className="max-w-md mx-auto text-center py-20">
          <h1 className="text-3xl font-bold mb-4">$PEP Economy</h1>
          <p className="text-gray-400 mb-8">
            Please log in with Discord to access the economy features.
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
            <h1 className="text-3xl font-bold">$PEP Economy</h1>
            <p className="text-gray-400">
              Welcome, {session.username || session.discordId}
            </p>
          </div>
          <nav className="flex gap-4">
            <Link
              href="/pep/shop"
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded transition"
            >
              Shop
            </Link>
            <Link
              href="/pep/jobs"
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded transition"
            >
              Jobs
            </Link>
          </nav>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-6">
            <WalletCard />
            <TransferForm />
          </div>
          <div>
            <Leaderboard />
          </div>
        </div>
      </div>
    </div>
  );
}
