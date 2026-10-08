"use client";

// app/pep/page.tsx
//
// capricciosa-35929 — Editorial restyle. Hero gets a `§ ··· The Economy`
// overline plus a clamp() display headline "PEP". Wallet and inventory
// surfaces inherit the paper-soft editorial vocabulary. All API calls,
// hooks, state, and the SendModal contract are UNCHANGED — only the JSX
// + presentation changed.
//
// anchovy-67435 (Restyle Phase 4d): semantic HSL tokens.
// sicilian-41551: mobile-first layout (single column under lg).

import React, { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { CrimeCard, GamesCard, Leaderboard, PepIcon, TransactionHistory } from "../ui/economy";
import { JobBoard } from "../ui/jobs";
import { ShopGrid } from "../ui/shop";
import { BountyBoard } from "../ui/bounties";
import { NotificationBell } from "../ui/notifications";
import { useMe } from "../lib/hooks/use-api";
import { input, pageContainer } from "../ui/shared-styles";
import { pillTomato } from "../ui/shared/Editorial";

type SessionData = {
  authenticated: boolean;
  discordId?: string;
  username?: string;
};

type InventoryItem = {
  itemId: number;
  quantity: number;
  item: {
    id: number;
    name: string;
    description: string | null;
    image: string | null;
    isCollectible?: boolean;
  };
};

type SendModalProps = {
  type: "pep" | "item";
  itemName?: string;
  itemId?: number;
  maxQuantity?: number;
  onClose: () => void;
  onSuccess: () => void;
};

function inputWithFocus(
  e: React.FocusEvent<HTMLInputElement>,
  focused: boolean,
) {
  if (focused) {
    e.currentTarget.style.borderColor = "hsl(var(--ring))";
    e.currentTarget.style.boxShadow = "0 0 0 3px hsl(var(--ring) / 0.20)";
  } else {
    e.currentTarget.style.borderColor = "hsl(var(--rule) / 0.22)";
    e.currentTarget.style.boxShadow = "none";
  }
}

function SendModal({ type, itemName, itemId, maxQuantity, onClose, onSuccess }: SendModalProps) {
  const [memberId, setMemberId] = useState("");
  const [amount, setAmount] = useState("1");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!memberId || !amount) return;

    setLoading(true);
    setError(null);

    try {
      if (type === "pep") {
        const res = await fetch("/api/economy/transfer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toUserId: memberId, amount: Number(amount) }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
      } else {
        const res = await fetch("/api/inventory/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toUserId: memberId, itemId, quantity: Number(amount) }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
      }
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setLoading(false);
    }
  };

  const disabled = loading || !memberId || !amount;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "hsl(var(--ink) / 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        className="paper-soft fade-up relative overflow-hidden rounded-[24px] border"
        style={{
          maxWidth: 440,
          width: "100%",
          background: "hsl(var(--card))",
          borderColor: "hsl(var(--rule-warm) / 0.55)",
          boxShadow: "var(--shadow-lifted)",
          padding: 24,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative flex items-start justify-between gap-4">
          <p className="overline text-tomato">§ ··· Send</p>
          <span
            className="handwritten -rotate-[6deg]"
            style={{
              fontSize: 14,
              color: "hsl(var(--foreground) / 0.55)",
            }}
          >
            on the books
          </span>
        </div>

        <h2
          className="font-[family-name:var(--font-display)] relative mt-2 flex items-center gap-2 font-black tracking-[-0.02em] text-foreground"
          style={{
            fontSize: "clamp(1.5rem, 4vw, 2rem)",
            lineHeight: 0.95,
          }}
        >
          Send {type === "pep" ? <PepIcon size={26} /> : itemName}
        </h2>

        {error && (
          <div
            className="relative mt-4"
            style={{
              padding: 12,
              background: "hsl(var(--tomato) / 0.08)",
              border: "1px solid hsl(var(--tomato) / 0.30)",
              borderRadius: "var(--radius)",
              color: "hsl(var(--tomato))",
              fontSize: 14,
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSend} className="relative mt-5 grid gap-4">
          <div>
            <label className="overline mb-2 block text-foreground/55">
              Recipient Member ID
            </label>
            <input
              type="text"
              placeholder="Enter member ID"
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              style={input()}
              disabled={loading}
              onFocus={(e) => inputWithFocus(e, true)}
              onBlur={(e) => inputWithFocus(e, false)}
            />
          </div>

          <div className="rule-warm" />

          <div>
            <label className="overline mb-2 block text-foreground/55">
              {`Amount${maxQuantity ? ` (max: ${maxQuantity})` : ""}`}
            </label>
            <input
              type="number"
              placeholder="Amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              style={input()}
              disabled={loading}
              min="1"
              max={maxQuantity}
              onFocus={(e) => inputWithFocus(e, true)}
              onBlur={(e) => inputWithFocus(e, false)}
            />
          </div>

          <div className="mt-2 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="btn-pill flex-1"
              style={{
                background: "hsl(var(--secondary))",
                color: "hsl(var(--secondary-foreground))",
                border: "1px solid hsl(var(--rule-warm) / 0.55)",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={disabled}
              className="btn-pill-lg group flex-1"
              style={{
                background: "hsl(var(--tomato))",
                color: "hsl(var(--cream))",
                border: "1px solid hsl(var(--tomato))",
                boxShadow: disabled ? "none" : "var(--shadow-soft)",
              }}
            >
              {loading ? "Sending..." : (
                <>
                  Send
                  <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SendGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2L11 13" />
      <path d="M22 2L15 22L11 13L2 9L22 2Z" />
    </svg>
  );
}

/** Icon-only send button (inventory rows). Labelled for screen readers. */
function SendIcon({ size = 16, label, onClick }: { size?: number; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-muted-foreground transition-colors hover:bg-[hsl(var(--tomato)/0.08)] hover:text-tomato focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato"
    >
      <SendGlyph size={size} />
    </button>
  );
}

// /pep fixes: the wallet used to sit in half of the right column (~230px on
// desktop). The clamp()-sized balance ran out of the card ("4,200" clipped at
// the right edge), the rotated "balance" note and the unlabeled send icon were
// absolutely stacked on top of the number, and the overline wrapped onto two
// lines. It now spans the column: overline, display balance with a plain
// "$PEP" unit, and a labelled "Send $PEP" pill.
function WalletWithSend({ walletKey, onSendClick }: { walletKey: number; onSendClick: () => void }) {
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchBalance = async () => {
      try {
        const res = await fetch("/api/economy/balance", { cache: "no-store" });
        const data = await res.json();
        if (res.ok) setBalance(data.balance);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };
    fetchBalance();
  }, [walletKey]);

  return (
    <section
      data-testid="pep-wallet"
      className="paper-soft relative overflow-hidden rounded-[24px] border p-6 md:p-7"
      style={{
        background: "hsl(var(--butter) / 0.14)",
        borderColor: "hsl(var(--rule-warm) / 0.55)",
        boxShadow: "var(--shadow-soft)",
      }}
    >
      <div className="relative flex items-baseline justify-between gap-4">
        <p className="overline m-0 text-tomato">§ ··· Your wallet</p>
        <span
          className="handwritten -rotate-[6deg] whitespace-nowrap"
          style={{ fontSize: 15, color: "hsl(var(--foreground) / 0.55)" }}
        >
          on the books
        </span>
      </div>

      {loading ? (
        <div className="relative mt-5 h-[60px] rounded-[var(--radius)] bg-muted" aria-busy="true" />
      ) : (
        <>
          <div className="relative mt-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
            <p className="m-0 min-w-0 flex items-baseline gap-2 text-foreground">
              <span
                className="font-[family-name:var(--font-display)] font-black tabular-nums tracking-[-0.025em]"
                style={{ fontSize: "clamp(2.25rem, 4.5vw, 3rem)", lineHeight: 0.95, overflowWrap: "anywhere" }}
              >
                {(balance ?? 0).toLocaleString()}
              </span>
              <span className="font-[family-name:var(--font-display)] text-lg font-black text-tomato">$PEP</span>
            </p>
            <button
              type="button"
              onClick={onSendClick}
              className={`${pillTomato} gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
              style={{ padding: "0.5rem 1.1rem" }}
            >
              <SendGlyph size={15} />
              Send $PEP
            </button>
          </div>

          <div className="rule-warm relative mt-5" />

          <p className="relative mt-3 mb-0 text-[10px] font-semibold uppercase tracking-[0.24em] text-foreground/55">
            Available balance
          </p>
        </>
      )}
    </section>
  );
}

function InventoryWithSend({ walletKey, onSendItem }: { walletKey: number; onSendItem: (item: InventoryItem) => void }) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchInventory = async () => {
      try {
        const res = await fetch("/api/inventory", { cache: "no-store" });
        const data = await res.json();
        if (res.ok) setItems(data.inventory || []);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };
    fetchInventory();
  }, [walletKey]);

  return (
    <section
      data-testid="pep-inventory"
      className="paper-soft relative overflow-hidden rounded-[24px] border p-6 md:p-7"
      style={{
        background: "hsl(var(--card))",
        borderColor: "hsl(var(--rule-warm) / 0.55)",
        boxShadow: "var(--shadow-soft)",
      }}
    >
      <div className="relative flex items-baseline justify-between gap-4">
        <p className="overline m-0 text-tomato">§ ··· Inventory</p>
        <span
          className="handwritten -rotate-[5deg] whitespace-nowrap"
          style={{ fontSize: 14, color: "hsl(var(--foreground) / 0.55)" }}
        >
          in the safe
        </span>
      </div>
      <h2
        className="font-[family-name:var(--font-display)] relative mt-2 mb-0 font-black tracking-[-0.02em] text-foreground"
        style={{ fontSize: "clamp(1.4rem, 3vw, 1.9rem)", lineHeight: 0.95 }}
      >
        Your inventory
      </h2>

      {loading ? (
        <div className="relative mt-5 h-[60px] rounded-[var(--radius)] bg-muted" aria-busy="true" />
      ) : items.length === 0 ? (
        <p className="relative mt-4 mb-0 text-sm text-muted-foreground">
          No items yet. Anything you buy in the shop below lands here.
        </p>
      ) : (
        <ul className="relative mt-4 mb-0 grid list-none gap-2 p-0">
          {items.map((inv) => (
            <li
              key={inv.itemId}
              className="flex items-center justify-between gap-3 rounded-[14px] border border-[hsl(var(--rule-warm)/0.45)] bg-background py-1.5 pr-1.5 pl-3"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                {inv.item.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={inv.item.image} alt="" className="h-8 w-8 shrink-0 rounded-md object-cover" />
                )}
                <div className="min-w-0">
                  <div className="font-[family-name:var(--font-display)] truncate text-sm font-black tracking-tight text-foreground">
                    {inv.item.name}
                  </div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    × {inv.quantity}
                    {inv.item.isCollectible ? " · collectible" : ""}
                  </div>
                </div>
              </div>
              <SendIcon size={16} label={`Send ${inv.item.name}`} onClick={() => onSendItem(inv)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function PepDashboard() {
  const { data: meData, isLoading: meLoading } = useMe();
  const session: SessionData | null = meLoading ? null : (meData ?? { authenticated: false });
  const loading = meLoading;

  const [walletKey, setWalletKey] = useState(0);
  const [sendModal, setSendModal] = useState<{
    type: "pep" | "item";
    itemName?: string;
    itemId?: number;
    maxQuantity?: number;
  } | null>(null);

  const refreshWallet = () => {
    setWalletKey((k) => k + 1);
  };

  // Flag-gated cards (PEP_CRIME_ENABLED / PEP_GAMES_ENABLED): hidden unless on.
  const [features, setFeatures] = useState<{ crime: boolean; games: boolean }>({ crime: false, games: false });
  useEffect(() => {
    if (!meData?.authenticated) return;
    fetch("/api/economy/features")
      .then((r) => (r.ok ? r.json() : null))
      .then((f) => f && setFeatures({ crime: !!f.crime, games: !!f.games }))
      .catch(() => {});
  }, [meData?.authenticated]);

  if (loading) {
    return (
      <div style={pageContainer()}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div
            className="paper-soft relative overflow-hidden rounded-[24px] border"
            style={{
              height: 240,
              background: "hsl(var(--muted))",
              borderColor: "hsl(var(--rule-warm) / 0.55)",
            }}
          />
        </div>
      </div>
    );
  }

  if (!session?.authenticated) {
    return (
      <div
        style={{
          ...pageContainer(),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          className="paper-soft fade-up relative overflow-hidden rounded-[24px] border p-8 text-center"
          style={{
            maxWidth: 460,
            width: "100%",
            background: "hsl(var(--butter) / 0.14)",
            borderColor: "hsl(var(--rule-warm) / 0.55)",
            boxShadow: "var(--shadow-lifted)",
          }}
        >
          <p className="overline relative text-tomato">§ ··· The Economy</p>
          <h1
            className="font-[family-name:var(--font-display)] relative mt-3 flex items-center justify-center gap-3 font-black tracking-[-0.03em] text-foreground"
            style={{
              fontSize: "clamp(2.5rem, 8vw, 4rem)",
              lineHeight: 0.9,
            }}
          >
            <PepIcon size={42} /> PEP
          </h1>
          <p
            className="relative mt-4"
            style={{ color: "hsl(var(--muted-foreground))", margin: 0 }}
          >
            Please log in with Discord to access the economy features.
          </p>
          <button
            onClick={() => {
              (window.top || window).location.href = "/api/discord/login";
            }}
            className="btn-pill-lg group relative mt-6"
            style={{
              background: "hsl(var(--tomato))",
              color: "hsl(var(--cream))",
              border: "1px solid hsl(var(--tomato))",
              boxShadow: "var(--shadow-soft)",
            }}
          >
            Login with Discord
            <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={pageContainer()}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }} className="fade-up">
        {/* ─── Editorial hero ─────────────────────────────────────── */}
        <header
          className="relative mb-8"
          style={{
            background:
              "radial-gradient(80% 60% at 20% 0%, hsl(46 100% 62% / 0.20), transparent 60%), radial-gradient(70% 60% at 95% 10%, hsl(0 93% 60% / 0.08), transparent 65%)",
            borderRadius: 28,
            padding: "4px 0 12px",
          }}
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="overline text-tomato">§ ··· The Economy</p>
              <h1
                className="font-[family-name:var(--font-display)] mt-3 flex flex-wrap items-center gap-4 font-black tracking-[-0.035em] text-foreground"
                style={{
                  fontSize: "clamp(3rem, 12vw, 7rem)",
                  lineHeight: 0.88,
                  overflowWrap: "anywhere",
                }}
              >
                <PepIcon size={64} /> PEP
              </h1>
            </div>

            <div className="flex shrink-0 items-center gap-2 pt-2">
              <NotificationBell />
            </div>
          </div>

          <div className="rule-warm mt-6" />
        </header>


        {/*
          sicilian-41551: stacks under lg, side-by-side from lg up.
        */}
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          {/* Left: Jobs and Bounties */}
          <div className="min-w-0">
            <JobBoard onJobCompleted={refreshWallet} />
            <BountyBoard
              currentUserId={session.discordId || ""}
              onBountyAction={refreshWallet}
            />
            {(features.crime || features.games) && (
              <div className="mt-6 grid gap-6">
                {features.crime && <CrimeCard onResult={refreshWallet} />}
                {features.games && <GamesCard onResult={refreshWallet} />}
              </div>
            )}
          </div>

          {/* Right: Wallet, Leaderboard, Inventory, Shop, Transactions */}
          {/*
            /pep fixes: wallet, leaderboard and inventory used to share a
            nested `sm:grid-cols-2` inside this ~440px column, squeezing each
            card to ~230px (balance clipped, leaderboard names collapsed).
            They now stack at full column width.
          */}
          <div className="grid min-w-0 content-start gap-6">
            <WalletWithSend
              walletKey={walletKey}
              onSendClick={() => setSendModal({ type: "pep" })}
            />
            <Leaderboard refreshKey={walletKey} />
            <InventoryWithSend
              walletKey={walletKey}
              onSendItem={(inv) =>
                setSendModal({
                  type: "item",
                  itemName: inv.item.name,
                  itemId: inv.itemId,
                  maxQuantity: inv.quantity,
                })
              }
            />

            {/* Shop — editorial card */}
            <div
              className="paper-soft relative overflow-hidden rounded-[24px] border p-6 md:p-7"
              style={{
                background: "hsl(var(--card))",
                borderColor: "hsl(var(--rule-warm) / 0.55)",
                boxShadow: "var(--shadow-soft)",
              }}
            >
              <div className="relative flex items-start justify-between gap-4">
                <p className="overline text-tomato">§ ··· The shop</p>
                <span
                  className="handwritten -rotate-[5deg]"
                  style={{ fontSize: 14, color: "hsl(var(--foreground) / 0.55)" }}
                >
                  bring your respect
                </span>
              </div>
              <h2
                className="font-[family-name:var(--font-display)] relative mt-2 font-black tracking-[-0.02em] text-foreground"
                style={{
                  fontSize: "clamp(1.6rem, 3.5vw, 2.25rem)",
                  lineHeight: 0.95,
                }}
              >
                Shop
              </h2>
              <div className="relative mt-4">
                <ShopGrid key={`shop-${walletKey}`} onPurchase={refreshWallet} />
              </div>
            </div>

            {/* Transaction History */}
            <TransactionHistory refreshKey={walletKey} />
          </div>
        </div>
      </div>

      {/* Send Modal */}
      {sendModal && (
        <SendModal
          type={sendModal.type}
          itemName={sendModal.itemName}
          itemId={sendModal.itemId}
          maxQuantity={sendModal.maxQuantity}
          onClose={() => setSendModal(null)}
          onSuccess={refreshWallet}
        />
      )}
    </div>
  );
}
