"use client";

import React, { useState, useEffect, useCallback } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";

interface Wallet {
  id: number;
  memberId: string;
  walletAddress: string;
  label: string | null;
  chainType: string;
  isPrimary: boolean;
  source: string;
  createdAt: string;
}

interface WalletManagerProps {
  memberId: string;
}

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function WalletManager({ memberId }: WalletManagerProps) {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [manualAddress, setManualAddress] = useState("");
  const [manualChain, setManualChain] = useState<"evm" | "solana">("evm");
  const [manualLabel, setManualLabel] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const { address: connectedAddress, isConnected } = useAccount();

  const fetchWallets = useCallback(async () => {
    try {
      const res = await fetch(`/api/wallet?memberId=${memberId}`);
      if (res.ok) {
        const data = await res.json();
        setWallets(data.wallets || []);
      }
    } catch {
      // Ignore fetch errors on load
    } finally {
      setLoading(false);
    }
  }, [memberId]);

  useEffect(() => {
    fetchWallets();
  }, [fetchWallets]);

  // When user connects via RainbowKit, auto-save the wallet
  useEffect(() => {
    async function autoSave() {
      if (!isConnected || !connectedAddress || saving) return;
      // Check if this address is already saved
      const alreadySaved = wallets.some(
        (w) => w.walletAddress.toLowerCase() === connectedAddress.toLowerCase()
      );
      if (alreadySaved) return;

      setSaving(true);
      setError(null);
      try {
        const res = await fetch("/api/wallet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            memberId,
            walletAddress: connectedAddress,
            chainType: "evm",
          }),
        });
        if (res.ok) {
          await fetchWallets();
        } else {
          const data = await res.json();
          if (res.status !== 409) {
            setError(data.error || "Failed to save wallet");
          }
        }
      } catch {
        setError("Failed to save wallet");
      } finally {
        setSaving(false);
      }
    }
    autoSave();
  }, [isConnected, connectedAddress, wallets, memberId, saving, fetchWallets]);

  const handleManualAdd = async () => {
    if (!manualAddress.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memberId,
          walletAddress: manualAddress.trim(),
          chainType: manualChain,
          label: manualLabel.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setManualAddress("");
        setManualLabel("");
        setShowManualAdd(false);
        await fetchWallets();
      } else {
        setError(data.error || "Failed to add wallet");
      }
    } catch {
      setError("Failed to add wallet");
    } finally {
      setSaving(false);
    }
  };

  const handleSetPrimary = async (walletId: number) => {
    setError(null);
    try {
      const res = await fetch("/api/wallet", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, walletId, isPrimary: true }),
      });
      if (res.ok) {
        const data = await res.json();
        setWallets(data.wallets || []);
      }
    } catch {
      setError("Failed to set primary");
    }
  };

  const handleUpdateLabel = async (walletId: number) => {
    setError(null);
    try {
      const res = await fetch("/api/wallet", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, walletId, label: editLabel }),
      });
      if (res.ok) {
        const data = await res.json();
        setWallets(data.wallets || []);
        setEditingId(null);
      }
    } catch {
      setError("Failed to update label");
    }
  };

  const handleDelete = async (walletId: number) => {
    setError(null);
    try {
      const res = await fetch("/api/wallet", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId, walletId }),
      });
      if (res.ok) {
        const data = await res.json();
        setWallets(data.wallets || []);
        setConfirmDeleteId(null);
      }
    } catch {
      setError("Failed to delete wallet");
    }
  };

  const sectionStyle: React.CSSProperties = {
    marginTop: 24,
    paddingTop: 24,
    borderTop: "1px solid var(--color-divider)",
  };

  const chainBadge = (chain: string): React.CSSProperties => ({
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 600,
    background: chain === "solana" ? "#9945FF20" : "#627EEA20",
    color: chain === "solana" ? "#9945FF" : "#627EEA",
    textTransform: "uppercase" as const,
  });

  const primaryBadge: React.CSSProperties = {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 600,
    background: "#f59e0b20",
    color: "#d97706",
  };

  const actionBtn: React.CSSProperties = {
    background: "transparent",
    border: "none",
    cursor: "pointer",
    fontSize: 12,
    fontFamily: "inherit",
    padding: "4px 8px",
    borderRadius: 6,
    color: "var(--color-text-secondary)",
  };

  if (loading) {
    return (
      <div style={sectionStyle}>
        <h3 style={{ fontSize: 18, marginTop: 0, marginBottom: 16, fontWeight: 600 }}>
          Wallets
        </h3>
        <div style={{ opacity: 0.5, fontSize: 14 }}>Loading wallets...</div>
      </div>
    );
  }

  return (
    <div style={sectionStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <h3 style={{ fontSize: 18, margin: 0, fontWeight: 600 }}>
          Wallets
          {wallets.length > 0 && (
            <span style={{ fontSize: 14, fontWeight: 400, opacity: 0.6, marginLeft: 8 }}>
              ({wallets.length})
            </span>
          )}
        </h3>
      </div>

      {error && (
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            background: "#fee2e2",
            color: "#dc2626",
            fontSize: 13,
            marginBottom: 12,
          }}
        >
          {error}
          <button
            onClick={() => setError(null)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              float: "right",
              fontSize: 14,
              color: "#dc2626",
              fontWeight: 600,
            }}
          >
            x
          </button>
        </div>
      )}

      {/* Wallet list */}
      {wallets.length > 0 && (
        <div style={{ display: "grid", gap: 8, marginBottom: 16 }}>
          {wallets.map((w) => (
            <div
              key={w.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                flexWrap: "wrap",
              }}
            >
              {/* Address + badges */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <code
                    style={{
                      fontSize: 14,
                      fontWeight: 500,
                      fontFamily: "monospace",
                      wordBreak: "break-all",
                    }}
                    title={w.walletAddress}
                  >
                    {truncateAddress(w.walletAddress)}
                  </code>
                  <span style={chainBadge(w.chainType)}>{w.chainType}</span>
                  {w.isPrimary && <span style={primaryBadge}>Primary</span>}
                </div>
                {/* Label display / edit */}
                {editingId === w.id ? (
                  <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                    <input
                      type="text"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      placeholder="Label (e.g. Main, Vault)"
                      maxLength={30}
                      style={{
                        padding: "4px 8px",
                        borderRadius: 6,
                        border: "1px solid var(--color-border-strong)",
                        fontSize: 12,
                        fontFamily: "inherit",
                        flex: 1,
                        minWidth: 100,
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleUpdateLabel(w.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      autoFocus
                    />
                    <button
                      onClick={() => handleUpdateLabel(w.id)}
                      style={{
                        ...actionBtn,
                        background: "var(--color-btn-primary-bg)",
                        color: "var(--color-btn-primary-text)",
                        fontWeight: 600,
                      }}
                    >
                      Save
                    </button>
                    <button onClick={() => setEditingId(null)} style={actionBtn}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  w.label && (
                    <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>{w.label}</div>
                  )
                )}
              </div>

              {/* Actions */}
              {editingId !== w.id && (
                <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                  <button
                    onClick={() => {
                      setEditingId(w.id);
                      setEditLabel(w.label || "");
                    }}
                    style={actionBtn}
                    title="Edit label"
                  >
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                      <path d="m15 5 4 4" />
                    </svg>
                  </button>
                  {!w.isPrimary && (
                    <button
                      onClick={() => handleSetPrimary(w.id)}
                      style={actionBtn}
                      title="Set as primary"
                    >
                      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                    </button>
                  )}
                  {confirmDeleteId === w.id ? (
                    <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: "#dc2626" }}>Delete?</span>
                      <button
                        onClick={() => handleDelete(w.id)}
                        style={{ ...actionBtn, color: "#dc2626", fontWeight: 600 }}
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        style={actionBtn}
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(w.id)}
                      style={actionBtn}
                      title="Remove wallet"
                    >
                      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18" />
                        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                      </svg>
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add wallet section */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {saving ? (
          <div style={{ fontSize: 13, opacity: 0.6 }}>Saving wallet...</div>
        ) : (
          <>
            <ConnectButton.Custom>
              {({ openConnectModal, account }) => (
                <button
                  onClick={openConnectModal}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "8px 16px",
                    borderRadius: 10,
                    border: "1px solid var(--color-border-strong)",
                    background: "var(--color-btn-primary-bg)",
                    color: "var(--color-btn-primary-text)",
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
                    <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
                    <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
                  </svg>
                  Connect Wallet
                </button>
              )}
            </ConnectButton.Custom>

            <button
              onClick={() => setShowManualAdd(!showManualAdd)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 16px",
                borderRadius: 10,
                border: "1px solid var(--color-border-strong)",
                background: "var(--color-surface)",
                color: "var(--color-text)",
                fontWeight: 600,
                fontSize: 13,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {showManualAdd ? "Cancel" : "Add Manually"}
            </button>
          </>
        )}
      </div>

      {/* Manual add form */}
      {showManualAdd && (
        <div
          style={{
            marginTop: 12,
            padding: 16,
            borderRadius: 10,
            border: "1px solid var(--color-border)",
            background: "var(--color-surface)",
            display: "grid",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select
              value={manualChain}
              onChange={(e) => setManualChain(e.target.value as "evm" | "solana")}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid var(--color-border-strong)",
                fontSize: 13,
                fontFamily: "inherit",
                background: "var(--color-surface)",
                color: "var(--color-text)",
              }}
            >
              <option value="evm">EVM (Ethereum)</option>
              <option value="solana">Solana</option>
            </select>
            <input
              type="text"
              value={manualAddress}
              onChange={(e) => setManualAddress(e.target.value)}
              placeholder={
                manualChain === "evm" ? "0x..." : "Solana address..."
              }
              style={{
                flex: 1,
                minWidth: 200,
                padding: "8px 12px",
                borderRadius: 8,
                border: "1px solid var(--color-border-strong)",
                fontSize: 13,
                fontFamily: "monospace",
              }}
            />
          </div>
          <input
            type="text"
            value={manualLabel}
            onChange={(e) => setManualLabel(e.target.value)}
            placeholder="Label (optional, e.g. Vault, Hardware)"
            maxLength={30}
            style={{
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid var(--color-border-strong)",
              fontSize: 13,
              fontFamily: "inherit",
            }}
          />
          <button
            onClick={handleManualAdd}
            disabled={!manualAddress.trim() || saving}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "8px 20px",
              borderRadius: 10,
              border: "none",
              background: "var(--color-btn-primary-bg)",
              color: "var(--color-btn-primary-text)",
              fontWeight: 600,
              fontSize: 13,
              cursor: !manualAddress.trim() || saving ? "default" : "pointer",
              opacity: !manualAddress.trim() || saving ? 0.5 : 1,
              fontFamily: "inherit",
            }}
          >
            {saving ? "Adding..." : "Add Wallet"}
          </button>
        </div>
      )}

      {/* Empty state */}
      {wallets.length === 0 && !showManualAdd && (
        <div
          style={{
            marginTop: 12,
            padding: "16px",
            borderRadius: 10,
            border: "1px dashed rgba(0,0,0,0.2)",
            background: "var(--color-page-bg)",
            textAlign: "center",
            fontSize: 13,
            opacity: 0.6,
          }}
        >
          No wallets connected yet. Connect a wallet to display your NFT and POAP collections.
        </div>
      )}
    </div>
  );
}
