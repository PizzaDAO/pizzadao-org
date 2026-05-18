"use client";

import React, { useState, useEffect } from "react";

interface WalletInfo {
  walletAddress: string;
  chainType: string;
  label: string | null;
  isPrimary: boolean;
}

interface WalletDisplayProps {
  memberId: string;
}

const displayFont =
  "var(--font-display), var(--font-sans), system-ui, sans-serif";
const monoFont =
  "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace";

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/**
 * Read-only wallet display for public profile pages.
 * Fetches wallets from the public NFT API (which returns walletAddress),
 * and from a dedicated public endpoint.
 */
export function WalletDisplay({ memberId }: WalletDisplayProps) {
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchWallets() {
      try {
        const res = await fetch(`/api/wallet/public?memberId=${memberId}`);
        if (res.ok) {
          const data = await res.json();
          setWallets(data.wallets || []);
        }
      } catch {
        // Ignore errors for public display
      } finally {
        setLoading(false);
      }
    }
    fetchWallets();
  }, [memberId]);

  if (loading || wallets.length === 0) return null;

  const chainBadge = (chain: string): React.CSSProperties => ({
    display: "inline-block",
    padding: "1px 6px",
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
    background:
      chain === "solana"
        ? "hsl(var(--butter) / 0.35)"
        : "hsl(var(--muted))",
    color: "hsl(var(--foreground))",
    border:
      chain === "solana"
        ? "1px solid hsl(var(--butter) / 0.60)"
        : "1px solid hsl(var(--rule) / 0.22)",
    textTransform: "uppercase" as const,
    fontFamily: displayFont,
    letterSpacing: "0.05em",
  });

  return (
    <div style={{ gridColumn: "1 / -1" }}>
      <h3
        style={{
          fontFamily: displayFont,
          fontSize: 12,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "hsl(var(--muted-foreground))",
          marginTop: 0,
          marginBottom: 8,
          fontWeight: 700,
        }}
      >
        Wallets
      </h3>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {wallets.map((w, i) => (
          <a
            key={i}
            href={
              w.chainType === "solana"
                ? `https://solscan.io/account/${w.walletAddress}`
                : `https://etherscan.io/address/${w.walletAddress}`
            }
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              borderRadius: "var(--radius)",
              border: "1px solid hsl(var(--rule) / 0.12)",
              background: "hsl(var(--card))",
              textDecoration: "none",
              color: "hsl(var(--foreground))",
              fontSize: 13,
              transition: "border-color 150ms ease, box-shadow 150ms ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "hsl(var(--rule) / 0.22)";
              e.currentTarget.style.boxShadow =
                "0 8px 30px hsl(var(--ink) / 0.06)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "hsl(var(--rule) / 0.12)";
              e.currentTarget.style.boxShadow = "none";
            }}
            title={w.walletAddress}
          >
            <code style={{ fontFamily: monoFont, fontSize: 12 }}>
              {truncateAddress(w.walletAddress)}
            </code>
            <span style={chainBadge(w.chainType)}>{w.chainType}</span>
            {w.label && (
              <span
                style={{
                  fontSize: 11,
                  color: "hsl(var(--muted-foreground))",
                }}
              >
                {w.label}
              </span>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}
