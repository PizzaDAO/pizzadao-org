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
import Link from "next/link";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { Leaderboard, PepIcon, PepAmount, TransactionHistory } from "../ui/economy";
import { JobBoard } from "../ui/jobs";
import { ShopGrid } from "../ui/shop";
import { BountyBoard } from "../ui/bounties";
import { NotificationBell } from "../ui/notifications";
import { useMe, useMemberLookup } from "../lib/hooks/use-api";
import { input, pageContainer } from "../ui/shared-styles";

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

function SendIcon({ size = 16, onClick }: { size?: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: 4,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "hsl(var(--muted-foreground))",
        transition: "color 150ms ease",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = "hsl(var(--tomato))")}
      onMouseLeave={(e) => (e.currentTarget.style.color = "hsl(var(--muted-foreground))")}
      title="Send"
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 2L11 13" />
        <path d="M22 2L15 22L11 13L2 9L22 2Z" />
      </svg>
    </button>
  );
}

function WalletWithSend({ walletKey, onSendClick }: { walletKey: number; onSendClick: () => void }) {
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchBalance = async () => {
      try {
        const res = await fetch("/api/economy/balance");
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
    <div
      className="paper-soft relative overflow-hidden rounded-[24px] border p-6 md:p-7"
      style={{
        background: "hsl(var(--butter) / 0.14)",
        borderColor: "hsl(var(--rule-warm) / 0.55)",
        boxShadow: "var(--shadow-soft)",
      }}
    >
      <div className="relative flex items-start justify-between gap-4">
        <p className="overline text-tomato">§ ··· Your wallet</p>
        <span
          className="handwritten -rotate-[6deg]"
          style={{ fontSize: 15, color: "hsl(var(--foreground) / 0.55)" }}
        >
          ascertained
        </span>
      </div>

      {loading ? (
        <div
          className="relative mt-6"
          style={{
            height: 60,
            background: "hsl(var(--muted))",
            borderRadius: "var(--radius)",
          }}
        />
      ) : (
        <>
          <div className="relative mt-6 flex items-end justify-between gap-4">
            <div
              className="font-[family-name:var(--font-display)] font-black tracking-[-0.025em] text-foreground"
              style={{
                fontSize: "clamp(2.5rem, 6.5vw, 3.75rem)",
                lineHeight: 0.92,
                flex: 1,
                minWidth: 0,
              }}
            >
              <PepAmount amount={balance ?? 0} size={36} />
            </div>
            <div className="flex flex-col items-end gap-2 pb-1">
              <span
                className="handwritten rotate-[4deg]"
                style={{
                  fontSize: 16,
                  color: "hsl(var(--tomato))",
                  whiteSpace: "nowrap",
                }}
              >
                balance
              </span>
              <SendIcon size={22} onClick={onSendClick} />
            </div>
          </div>

          <div className="rule-warm relative mt-5" />

          <p className="ui relative mt-3 text-[10px] uppercase tracking-[0.28em] text-foreground/55">
            PEP available · ledger entry 01
          </p>
        </>
      )}
    </div>
  );
}

function InventoryWithSend({ walletKey, onSendItem }: { walletKey: number; onSendItem: (item: InventoryItem) => void }) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchInventory = async () => {
      try {
        const res = await fetch("/api/inventory");
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

  const surface: React.CSSProperties = {
    background: "hsl(var(--card))",
    borderColor: "hsl(var(--rule-warm) / 0.55)",
    boxShadow: "var(--shadow-soft)",
  };

  const header = (
    <div className="relative flex items-start justify-between gap-4">
      <p className="overline text-tomato">§ ··· Inventory</p>
      <span
        className="handwritten -rotate-[5deg]"
        style={{ fontSize: 14, color: "hsl(var(--foreground) / 0.55)" }}
      >
        in the safe
      </span>
    </div>
  );

  const heading = (
    <h2
      className="font-[family-name:var(--font-display)] relative mt-2 font-black tracking-[-0.02em] text-foreground"
      style={{
        fontSize: "clamp(1.4rem, 3vw, 1.9rem)",
        lineHeight: 0.95,
      }}
    >
      Your inventory
    </h2>
  );

  if (loading) {
    return (
      <div
        className="paper-soft relative overflow-hidden rounded-[24px] border p-6 md:p-7"
        style={surface}
      >
        {header}
        {heading}
        <div
          className="relative mt-5"
          style={{
            height: 60,
            background: "hsl(var(--muted))",
            borderRadius: "var(--radius)",
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="paper-soft relative overflow-hidden rounded-[24px] border p-6 md:p-7"
      style={surface}
    >
      {header}
      {heading}

      {items.length === 0 ? (
        <p
          className="relative mt-5 text-center"
          style={{
            color: "hsl(var(--muted-foreground))",
            padding: "16px 0",
            margin: 0,
          }}
        >
          No items yet
        </p>
      ) : (
        <div className="relative mt-4 grid gap-2">
          {items.map((inv) => (
            <div
              key={inv.itemId}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 12px",
                background: "hsl(var(--background))",
                border: "1px solid hsl(var(--rule-warm) / 0.45)",
                borderRadius: 14,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {inv.item.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={inv.item.image}
                    alt={inv.item.name}
                    style={{ width: 32, height: 32, borderRadius: 6 }}
                  />
                )}
                <div>
                  <div
                    className="font-[family-name:var(--font-display)] font-black tracking-tight"
                    style={{ fontSize: 14, color: "hsl(var(--foreground))" }}
                  >
                    {inv.item.name}
                  </div>
                  <div
                    className="ui text-[10px] uppercase tracking-[0.22em]"
                    style={{ color: "hsl(var(--muted-foreground))" }}
                  >
                    × {inv.quantity}
                  </div>
                </div>
              </div>
              <SendIcon size={16} onClick={() => onSendItem(inv)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function PepDashboard() {
  const { data: meData, isLoading: meLoading } = useMe();
  const session: SessionData | null = meLoading ? null : (meData ?? { authenticated: false });
  const { data: memberData } = useMemberLookup(
    meData?.authenticated && meData?.discordId ? meData.discordId : undefined
  );
  const memberName = memberData?.memberName ?? null;
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
              <p
                className="mt-4 text-foreground/70"
                style={{ fontSize: 17, lineHeight: 1.5, maxWidth: "44ch" }}
              >
                A community ledger.{" "}
                <span style={{ color: "hsl(var(--foreground))", fontWeight: 600 }}>
                  {memberName || session.username || session.discordId}
                </span>
                {" — "}every credit and debit on the record.
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2 pt-2">
              <NotificationBell />
              <Link
                href="/"
                className="btn-pill"
                style={{
                  background: "hsl(var(--secondary))",
                  color: "hsl(var(--secondary-foreground))",
                  border: "1px solid hsl(var(--rule-warm) / 0.55)",
                  textDecoration: "none",
                }}
              >
                <ArrowLeft className="h-4 w-4" /> Home
              </Link>
            </div>
          </div>

          <div className="rule-warm mt-6" />
        </header>

        {/* Under construction notice — paper-soft butter card */}
        <div
          className="paper-soft relative mb-7 flex items-center gap-3 overflow-hidden rounded-[20px] border"
          style={{
            padding: "12px 16px",
            border: "1px solid hsl(var(--butter) / 0.55)",
            background: "hsl(var(--butter) / 0.22)",
            color: "hsl(var(--ink))",
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          <span style={{ fontSize: 20 }}>🚧</span>
          <span className="relative">
            This page is under construction. Features may be incomplete or change without notice.
          </span>
        </div>

        {/*
          sicilian-41551: stacks under lg, side-by-side from lg up.
        */}
        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          {/* Left: Jobs and Bounties */}
          <div>
            <JobBoard onJobCompleted={refreshWallet} />
            <BountyBoard
              currentUserId={session.discordId || ""}
              onBountyAction={refreshWallet}
            />
          </div>

          {/* Right: Leaderboard, Balance, Inventory, Shop, Transactions */}
          <div className="grid content-start gap-6">
            <div className="grid gap-6 sm:grid-cols-2">
              <Leaderboard />
              <div className="grid content-start gap-6">
                <WalletWithSend
                  walletKey={walletKey}
                  onSendClick={() => setSendModal({ type: "pep" })}
                />
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
              </div>
            </div>

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
