"use client";

import { useEffect, useState } from "react";

interface UnlockTicketCardProps {
  memberId: string;
}

interface TicketRecord {
  eventName: string;
  networkId: number;
  lockAddress: string;
  tokenId: string;
}

interface WalletData {
  id: number;
  walletAddress: string;
  ticketCount: number;
  connectedAt: string;
  tickets: TicketRecord[];
}

type CardState = "loading" | "connected" | "not-connected" | "verifying" | "error" | "hidden";

const UNLOCK_CHECKOUT_URL = "https://app.unlock-protocol.com/checkout";

const NETWORK_NAMES: Record<number, string> = {
  1: "Ethereum",
  10: "Optimism",
  56: "BSC",
  137: "Polygon",
  8453: "Base",
  42161: "Arbitrum",
};

export function UnlockTicketCard({ memberId }: UnlockTicketCardProps) {
  const [state, setState] = useState<CardState>("loading");
  const [wallets, setWallets] = useState<WalletData[]>([]);
  const [totalTickets, setTotalTickets] = useState(0);
  const [isOwner, setIsOwner] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      try {
        // Fetch existing wallet data
        const statusRes = await fetch(`/api/unlock-tickets/${memberId}`);
        const status = await statusRes.json();
        const hasWallets = status.wallets && status.wallets.length > 0;

        // Check if viewer is the profile owner
        const meRes = await fetch("/api/me");
        let owner = false;
        if (meRes.ok) {
          const me = await meRes.json();
          if (me.discordId) {
            const lookupRes = await fetch(`/api/member-lookup/${me.discordId}`);
            if (lookupRes.ok) {
              const lookup = await lookupRes.json();
              owner = String(lookup.memberId) === String(memberId);
            }
          }
        }
        setIsOwner(owner);

        // Check if redirected back from Unlock with verified wallet
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get("unlock") === "verified" && owner) {
          // Clean up URL
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete("unlock");
          window.history.replaceState({}, "", cleanUrl.toString());

          // Auto-trigger verification (connects wallet)
          setState("verifying");
          await connectWallet();
          return;
        }

        if (hasWallets) {
          setWallets(status.wallets);
          setTotalTickets(status.totalTickets);
          setState("connected");
        } else if (owner) {
          setState("not-connected");
        } else {
          setState("hidden");
        }
      } catch {
        setState("hidden");
      }
    }
    if (memberId) init();
  }, [memberId]);

  async function connectWallet() {
    setState("verifying");
    try {
      const res = await fetch("/api/unlock-tickets/verify");
      if (!res.ok) {
        if (res.status === 401) {
          setState(wallets.length > 0 ? "connected" : "not-connected");
          return;
        }
        throw new Error("Connection failed");
      }
      const data = await res.json();

      // Refresh wallet list after connecting
      const statusRes = await fetch(`/api/unlock-tickets/${memberId}`);
      const status = await statusRes.json();
      setWallets(status.wallets || []);
      setTotalTickets(status.totalTickets || 0);

      if (data.ticketCount === 0 && !data.alreadyConnected) {
        setError("No GPP tickets found for this wallet.");
        setState("error");
      } else {
        setState("connected");
      }
    } catch {
      setError("Failed to connect wallet. Please try again.");
      setState("error");
    }
  }

  function handleUnlockLogin() {
    const redirectUri = `${window.location.origin}/api/unlock/callback`;
    const url = `${UNLOCK_CHECKOUT_URL}?client_id=${encodeURIComponent(window.location.origin)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;
    window.location.href = url;
  }

  // Hidden/loading states
  if (state === "loading" || state === "hidden") return null;

  return (
    <div
      style={{
        marginTop: 24,
        paddingTop: 24,
        borderTop: "1px solid var(--color-divider)",
      }}
    >
      <h3 style={{ marginTop: 0, marginBottom: 16, fontSize: 18 }}>
        Pizza Party Tickets
      </h3>

      {/* Connected — show tickets from all wallets */}
      {state === "connected" && wallets.length > 0 && (
        <div>
          <div
            style={{
              textAlign: "center",
              marginBottom: 20,
              padding: 16,
              borderRadius: 12,
              background: "var(--color-surface)",
              border: "1px solid var(--color-border)",
            }}
          >
            <div
              style={{
                fontSize: 40,
                fontWeight: 800,
                lineHeight: 1,
                color: "var(--color-text)",
              }}
            >
              {totalTickets}
            </div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: 1,
                opacity: 0.5,
                marginTop: 6,
              }}
            >
              GPP Ticket{totalTickets !== 1 ? "s" : ""}
            </div>
          </div>

          {/* All tickets across all wallets */}
          {wallets.some((w) => w.tickets.length > 0) && (
            <div style={{ display: "grid", gap: 4 }}>
              {wallets.flatMap((w) =>
                w.tickets.map((ticket, idx) => (
                  <div
                    key={`${w.id}-${idx}`}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "6px 10px",
                      borderRadius: 8,
                      background:
                        idx % 2 === 0 ? "transparent" : "var(--color-surface)",
                      fontSize: 13,
                    }}
                  >
                    <span style={{ fontWeight: 500 }}>{ticket.eventName}</span>
                    <span style={{ opacity: 0.5, fontSize: 12 }}>
                      {NETWORK_NAMES[ticket.networkId] || `Chain ${ticket.networkId}`}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Owner can connect another wallet */}
          {isOwner && (
            <div style={{ textAlign: "center", marginTop: 16 }}>
              <button
                onClick={handleUnlockLogin}
                style={{
                  padding: "8px 20px",
                  borderRadius: 8,
                  border: "1px solid var(--color-border)",
                  background: "transparent",
                  color: "var(--color-text)",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  opacity: 0.7,
                }}
              >
                Connect Another Wallet
              </button>
            </div>
          )}
        </div>
      )}

      {/* Not connected — owner sees connect prompt */}
      {state === "not-connected" && (
        <div style={{ textAlign: "center", padding: 20 }}>
          <p style={{ fontSize: 14, opacity: 0.7, marginBottom: 16 }}>
            Connect your Unlock wallet to see your GPP tickets.
          </p>
          <button
            onClick={handleUnlockLogin}
            style={{
              padding: "10px 24px",
              borderRadius: 8,
              border: "none",
              background: "#f59e0b",
              color: "#000",
              fontSize: 14,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Connect Unlock Wallet
          </button>
        </div>
      )}

      {/* Verifying / connecting */}
      {state === "verifying" && (
        <div style={{ textAlign: "center", padding: 20 }}>
          <div
            style={{
              fontSize: 14,
              opacity: 0.7,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
            }}
          >
            <span
              style={{
                display: "inline-block",
                width: 16,
                height: 16,
                border: "2px solid var(--color-text)",
                borderTopColor: "transparent",
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
              }}
            />
            Connecting wallet...
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      )}

      {/* Error */}
      {state === "error" && (
        <div style={{ textAlign: "center", padding: 20 }}>
          <p style={{ fontSize: 14, color: "#ef4444", marginBottom: 16 }}>
            {error}
          </p>
          {isOwner && (
            <button
              onClick={handleUnlockLogin}
              style={{
                padding: "10px 24px",
                borderRadius: 8,
                border: "none",
                background: "#f59e0b",
                color: "#000",
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Try Again
            </button>
          )}
        </div>
      )}
    </div>
  );
}
