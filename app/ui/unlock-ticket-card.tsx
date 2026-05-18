"use client";

import { useEffect, useState } from "react";
import { btn } from "./shared-styles";

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

/**
 * UnlockTicketCard — capers-48272 (Phase 4e restyle)
 * Distinct from POAP/NFT cards: uses the butter accent for the
 * "ticket / redeemable" feel, with an ink CTA via shared `btn("accent")`.
 */
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
    <div className="mt-6 pt-6 border-t border-rule">
      <h3 className="font-display text-lg font-semibold m-0 mb-4">
        Pizza Party Tickets
      </h3>

      {/* Connected — show tickets from all wallets */}
      {state === "connected" && wallets.length > 0 && (
        <div>
          {/* Hero count tile — butter accent */}
          <div className="text-center mb-5 px-4 py-5 rounded-[var(--radius)] border border-rule bg-butter/30">
            <div className="font-display text-5xl font-extrabold leading-none text-foreground">
              {totalTickets}
            </div>
            <div className="mt-1.5 text-xs font-bold uppercase tracking-widest text-ink/70 font-display">
              GPP Ticket{totalTickets !== 1 ? "s" : ""}
            </div>
          </div>

          {/* All tickets across all wallets */}
          {wallets.some((w) => w.tickets.length > 0) && (
            <div className="grid gap-1">
              {wallets.flatMap((w) =>
                w.tickets.map((ticket, idx) => (
                  <div
                    key={`${w.id}-${idx}`}
                    className={`flex justify-between items-center px-2.5 py-1.5 rounded-md text-[13px] ${
                      idx % 2 === 0 ? "bg-transparent" : "bg-muted"
                    }`}
                  >
                    <span className="font-medium">{ticket.eventName}</span>
                    <span className="text-xs text-muted-foreground">
                      {NETWORK_NAMES[ticket.networkId] || `Chain ${ticket.networkId}`}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Owner can connect another wallet — secondary outline */}
          {isOwner && (
            <div className="text-center mt-4">
              <button
                onClick={handleUnlockLogin}
                className="px-5 py-2 rounded-[var(--radius)] border border-rule bg-transparent text-foreground font-display text-[13px] font-semibold cursor-pointer hover:bg-muted transition-colors"
              >
                Connect Another Wallet
              </button>
            </div>
          )}
        </div>
      )}

      {/* Not connected — owner sees connect prompt */}
      {state === "not-connected" && (
        <div className="text-center py-5 px-4 rounded-[var(--radius)] border border-dashed border-rule bg-butter/20">
          <p className="text-sm text-muted-foreground italic mb-4">
            Connect your Unlock wallet to see your GPP tickets.
          </p>
          <button
            onClick={handleUnlockLogin}
            style={{
              ...btn("accent"),
              background: "hsl(var(--butter))",
              color: "hsl(var(--ink))",
              borderColor: "hsl(var(--butter))",
            }}
          >
            Connect Unlock Wallet
          </button>
        </div>
      )}

      {/* Verifying / connecting */}
      {state === "verifying" && (
        <div className="text-center py-5">
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <span className="inline-block w-4 h-4 border-2 border-tomato border-t-transparent rounded-full animate-spin" />
            Connecting wallet...
          </div>
        </div>
      )}

      {/* Error */}
      {state === "error" && (
        <div className="text-center py-5">
          <p className="text-sm text-destructive italic mb-4">
            {error}
          </p>
          {isOwner && (
            <button
              onClick={handleUnlockLogin}
              style={{
                ...btn("accent"),
                background: "hsl(var(--butter))",
                color: "hsl(var(--ink))",
                borderColor: "hsl(var(--butter))",
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
