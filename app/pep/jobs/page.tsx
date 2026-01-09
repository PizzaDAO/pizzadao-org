"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { JobBoard } from "../../ui/jobs";
import { WalletCard } from "../../ui/economy";

type SessionData = {
  authenticated: boolean;
  discordId?: string;
  username?: string;
};

function card(): React.CSSProperties {
  return {
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: 14,
    padding: 24,
    boxShadow: "0 8px 30px rgba(0,0,0,0.06)",
    background: "white",
  };
}

function btn(kind: "primary" | "secondary"): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "inline-block",
    padding: "10px 16px",
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.18)",
    fontWeight: 650,
    cursor: "pointer",
    textDecoration: "none",
    textAlign: "center",
  };
  if (kind === "primary") return { ...base, background: "black", color: "white", borderColor: "black" };
  return { ...base, background: "white", color: "black" };
}

export default function JobsPage() {
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
      <div style={{ minHeight: "100vh", background: "#fafafa", padding: "40px 20px" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div style={{ ...card(), height: 200, background: "rgba(0,0,0,0.04)" }} />
        </div>
      </div>
    );
  }

  if (!session?.authenticated) {
    return (
      <div style={{ minHeight: "100vh", background: "#fafafa", padding: "40px 20px", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ ...card(), maxWidth: 400, textAlign: "center" }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 16 }}>Jobs</h1>
          <p style={{ opacity: 0.6, marginBottom: 24 }}>
            Please log in with Discord to access jobs.
          </p>
          <Link href="/api/discord/login" style={btn("primary")}>
            Login with Discord
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#fafafa", padding: "40px 20px" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>Jobs</h1>
            <p style={{ opacity: 0.6, margin: 0 }}>Complete jobs to earn $PEP</p>
          </div>
          <nav style={{ display: "flex", gap: 10 }}>
            <Link href="/pep" style={btn("secondary")}>
              Wallet
            </Link>
            <Link href="/pep/shop" style={btn("secondary")}>
              Shop
            </Link>
          </nav>
        </header>

        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20 }}>
          <div>
            <JobBoard />
          </div>
          <div>
            <WalletCard />
          </div>
        </div>
      </div>
    </div>
  );
}
