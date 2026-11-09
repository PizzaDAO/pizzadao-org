"use client";

import { useEffect, useState } from "react";
import { btn } from "./shared-styles";

interface UnlockTicketCardProps {
  memberId: string;
}

interface TicketEvent {
  networkId: number;
  lockAddress: string;
  name: string;
  year: number | null;
  count: number;
  url: string | null;
}

interface Summary {
  totalTickets: number;
  events: TicketEvent[];
  wallets: number;
  refreshing?: boolean;
}

const UNLOCK_CHECKOUT_URL = "https://app.unlock-protocol.com/checkout";

const NETWORK_NAMES: Record<number, string> = {
  1: "Ethereum",
  10: "Optimism",
  56: "BSC",
  100: "Gnosis",
  137: "Polygon",
  8453: "Base",
  42161: "Arbitrum",
};

/**
 * UnlockTicketCard: Pizza Party Tickets for a member. The count and events come from a cached scan of
 * every wallet the member has (refreshed nightly and, in the background, when the data is old).
 * The owner can Rescan, and connect an Unlock wallet as one more way to add a wallet.
 */
export function UnlockTicketCard({ memberId }: UnlockTicketCardProps) {
  const [loaded, setLoaded] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      try {
        const [statusRes, meRes] = await Promise.all([fetch(`/api/unlock-tickets/${memberId}`), fetch("/api/me")]);
        if (statusRes.ok) setSummary(await statusRes.json());
        let owner = false;
        if (meRes.ok) {
          const me = await meRes.json();
          if (me.discordId) {
            const lookupRes = await fetch(`/api/member-lookup/${me.discordId}`);
            if (lookupRes.ok) owner = String((await lookupRes.json()).memberId) === String(memberId);
          }
        }
        setIsOwner(owner);

        // Back from the Unlock sign-in: add the wallet and scan.
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get("unlock") === "verified" && owner) {
          const cleanUrl = new URL(window.location.href);
          cleanUrl.searchParams.delete("unlock");
          window.history.replaceState({}, "", cleanUrl.toString());
          await call("/api/unlock-tickets/verify", "GET");
        }
      } catch {
        /* card stays hidden for non-owners */
      } finally {
        setLoaded(true);
      }
    }
    if (memberId) init();
  }, [memberId]);

  async function call(url: string, method: "GET" | "POST") {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(url, method === "POST" ? { method, headers: { "content-type": "application/json" }, body: "{}" } : { method });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (typeof data.totalTickets === "number") setSummary(data);
        return;
      }
      if (res.status === 429) {
        const mins = Math.max(1, Math.ceil((data.retryAfterSeconds ?? 60) / 60));
        setNote(`Rescanned recently. Try again in about ${mins} minute${mins === 1 ? "" : "s"}.`);
      } else {
        setNote(data.error || "Something went wrong. Please try again.");
      }
    } catch {
      setNote("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  function handleUnlockLogin() {
    const redirectUri = `${window.location.origin}/api/unlock/callback`;
    const url = `${UNLOCK_CHECKOUT_URL}?client_id=${encodeURIComponent(window.location.origin)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code`;
    window.location.href = url;
  }

  if (!loaded) return null;
  const total = summary?.totalTickets ?? 0;
  // Visitors only see the card when there is something to show.
  if (!isOwner && total === 0) return null;
  const events = summary?.events ?? [];

  return (
    <div className="mt-6 pt-6 border-t border-rule">
      <h3 className="font-display text-lg font-semibold m-0 mb-4">Pizza Party Tickets</h3>

      <div className="text-center mb-5 px-4 py-5 rounded-[var(--radius)] border border-rule bg-butter/30">
        <div className="font-display text-5xl font-extrabold leading-none text-foreground">{total}</div>
        <div className="mt-1.5 text-xs font-bold uppercase tracking-widest text-ink/70 font-display">
          Pizza Party Ticket{total !== 1 ? "s" : ""}
        </div>
      </div>

      {events.length > 0 && (
        <div className="grid gap-1">
          {events.map((e, idx) => (
            <div
              key={`${e.networkId}-${e.lockAddress}`}
              className={`flex justify-between items-center gap-3 px-2.5 py-1.5 rounded-md text-[13px] ${idx % 2 === 0 ? "bg-transparent" : "bg-muted"}`}
            >
              <span className="font-medium">
                {e.url ? (
                  <a href={e.url} target="_blank" rel="noopener noreferrer" className="underline">
                    {e.name}
                  </a>
                ) : (
                  e.name
                )}
                {e.count > 1 ? ` ×${e.count}` : ""}
              </span>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {NETWORK_NAMES[e.networkId] || `Chain ${e.networkId}`}
                {e.year ? ` · ${e.year}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}

      {isOwner && (
        <div className="mt-4 grid gap-2 justify-items-center text-center">
          {total === 0 && (
            <p className="text-sm text-muted-foreground italic m-0">
              {summary && summary.wallets > 0
                ? "No tickets found on your wallets yet. They are checked nightly, or press Rescan."
                : "Connect your Unlock wallet to see your Pizza Party Tickets."}
            </p>
          )}
          {note && <p className="text-sm text-muted-foreground m-0" role="status">{note}</p>}
          <div className="flex flex-wrap gap-2 justify-center">
            {summary && summary.wallets > 0 && (
              <button
                onClick={() => call("/api/unlock-tickets/rescan", "POST")}
                disabled={busy}
                className="px-5 py-2 rounded-[var(--radius)] border border-rule bg-transparent text-foreground font-display text-[13px] font-semibold cursor-pointer hover:bg-muted transition-colors disabled:opacity-50"
              >
                {busy ? "Scanning..." : "Rescan"}
              </button>
            )}
            <button
              onClick={handleUnlockLogin}
              disabled={busy}
              style={
                total === 0 && !(summary && summary.wallets > 0)
                  ? { ...btn("accent"), background: "hsl(var(--butter))", color: "hsl(var(--ink))", borderColor: "hsl(var(--butter))" }
                  : undefined
              }
              className={
                total === 0 && !(summary && summary.wallets > 0)
                  ? undefined
                  : "px-5 py-2 rounded-[var(--radius)] border border-rule bg-transparent text-foreground font-display text-[13px] font-semibold cursor-pointer hover:bg-muted transition-colors disabled:opacity-50"
              }
            >
              {summary && summary.wallets > 0 ? "Connect Another Wallet" : "Connect Unlock Wallet"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
