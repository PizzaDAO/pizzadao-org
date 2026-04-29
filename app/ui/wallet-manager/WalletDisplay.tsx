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
    borderRadius: 4,
    fontSize: 10,
    fontWeight: 600,
    background: chain === "solana" ? "#9945FF20" : "#627EEA20",
    color: chain === "solana" ? "#9945FF" : "#627EEA",
    textTransform: "uppercase" as const,
  });

  return (
    <div style={{ gridColumn: "1 / -1" }}>
      <h3
        style={{
          fontSize: 12,
          textTransform: "uppercase",
          letterSpacing: "1px",
          opacity: 0.5,
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
              gap: 4,
              padding: "4px 10px",
              borderRadius: 8,
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)",
              textDecoration: "none",
              color: "inherit",
              fontSize: 13,
            }}
            title={w.walletAddress}
          >
            <code style={{ fontFamily: "monospace", fontSize: 12 }}>
              {truncateAddress(w.walletAddress)}
            </code>
            <span style={chainBadge(w.chainType)}>{w.chainType}</span>
            {w.label && (
              <span style={{ fontSize: 11, opacity: 0.5 }}>{w.label}</span>
            )}
          </a>
        ))}
      </div>
    </div>
  );
}
