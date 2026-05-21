"use client";

// app/pep/page.tsx
//
// anchovy-67435 (Restyle Phase 4d): migrated off legacy `--color-*` aliases
// onto the new semantic HSL tokens + shared `card()`/`btn()` primitives.
// Page bg = cream, large Asap Condensed h1 "PEP economy", subtitle in
// muted-foreground. Send modal uses the shared `Field` label + tomato CTA.
// See plans/site-restyle-pizzadao-org.md.

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Leaderboard, PepIcon, PepAmount, TransactionHistory } from "../ui/economy";
import { JobBoard } from "../ui/jobs";
import { ShopGrid } from "../ui/shop";
import { BountyBoard } from "../ui/bounties";
import { NotificationBell } from "../ui/notifications";
import { useMe, useMemberLookup } from "../lib/hooks/use-api";
import { card, btn, input, overlay, pageContainer } from "../ui/shared-styles";
import { Field } from "../ui/onboarding/Field";

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

const DISPLAY_FONT =
  "var(--font-display), var(--font-sans), system-ui, sans-serif";

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
    <div style={overlay()} onClick={onClose}>
      <div
        // sicilian-41551: overlay() now provides 16px gutter so the modal
        // can be `width: "100%"` (capped by maxWidth) without going edge-to-edge.
        style={{ ...card(), maxWidth: 420, width: "100%" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          style={{
            fontFamily: DISPLAY_FONT,
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: "-0.01em",
            margin: 0,
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: "hsl(var(--foreground))",
          }}
        >
          Send {type === "pep" ? <PepIcon size={18} /> : itemName}
        </h2>

        {error && (
          <div
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

        <form onSubmit={handleSend} style={{ display: "grid", gap: 16 }}>
          <Field label="Recipient Member ID">
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
          </Field>

          <Field label={`Amount${maxQuantity ? ` (max: ${maxQuantity})` : ""}`}>
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
          </Field>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={onClose}
              style={{ ...btn("secondary"), flex: 1 }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={disabled}
              style={{ ...btn("accent", disabled), flex: 1 }}
            >
              {loading ? "Sending..." : "Send"}
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
    <div style={card()}>
      <h2
        style={{
          fontFamily: DISPLAY_FONT,
          fontSize: 22,
          fontWeight: 700,
          letterSpacing: "-0.01em",
          margin: 0,
          color: "hsl(var(--foreground))",
        }}
      >
        Your balance
      </h2>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "20px 22px",
          background: "hsl(var(--background))",
          border: "1px solid hsl(var(--rule) / 0.12)",
          borderRadius: "var(--radius)",
        }}
      >
        {loading ? (
          <div
            style={{
              height: 44,
              flex: 1,
              background: "hsl(var(--muted))",
              borderRadius: "var(--radius)",
            }}
          />
        ) : (
          <>
            <div
              style={{
                fontFamily: DISPLAY_FONT,
                fontSize: 40,
                fontWeight: 800,
                letterSpacing: "-0.02em",
                lineHeight: 1,
                color: "hsl(var(--tomato))",
                flex: 1,
              }}
            >
              <PepAmount amount={balance ?? 0} size={32} />
            </div>
            <SendIcon size={22} onClick={onSendClick} />
          </>
        )}
      </div>
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

  const heading = (
    <h2
      style={{
        fontFamily: DISPLAY_FONT,
        fontSize: 22,
        fontWeight: 700,
        letterSpacing: "-0.01em",
        margin: 0,
        color: "hsl(var(--foreground))",
      }}
    >
      Your inventory
    </h2>
  );

  if (loading) {
    return (
      <div style={card()}>
        {heading}
        <div
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
    <div style={card()}>
      {heading}
      {items.length === 0 ? (
        <p
          style={{
            color: "hsl(var(--muted-foreground))",
            textAlign: "center",
            padding: "16px 0",
            margin: 0,
          }}
        >
          No items yet
        </p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {items.map((inv) => (
            <div
              key={inv.itemId}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: 12,
                background: "hsl(var(--background))",
                border: "1px solid hsl(var(--rule) / 0.12)",
                borderRadius: "var(--radius)",
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
                  <div style={{ fontWeight: 600, fontSize: 14, color: "hsl(var(--foreground))" }}>
                    {inv.item.name}
                  </div>
                  <div style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
                    x{inv.quantity}
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
            style={{ ...card(), height: 220, background: "hsl(var(--muted))" }}
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
        <div style={{ ...card(), maxWidth: 420, textAlign: "center" }}>
          <h1
            style={{
              fontFamily: DISPLAY_FONT,
              fontSize: 40,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              margin: 0,
              display: "flex",
              alignItems: "center",
              gap: 10,
              justifyContent: "center",
              color: "hsl(var(--foreground))",
            }}
          >
            <PepIcon size={32} /> PEP economy
          </h1>
          <p style={{ color: "hsl(var(--muted-foreground))", margin: 0 }}>
            Please log in with Discord to access the economy features.
          </p>
          <button
            onClick={() => {
              (window.top || window).location.href = "/api/discord/login";
            }}
            style={btn("accent")}
          >
            Login with Discord
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={pageContainer()}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <header style={{ marginBottom: 28 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 16,
              marginBottom: 8,
              flexWrap: "wrap", // sicilian-41551: actions drop below on phones
            }}
          >
            <div style={{ minWidth: 0 }}>
              <h1
                style={{
                  fontFamily: DISPLAY_FONT,
                  // sicilian-41551: was 56px — scaled to fit a 375px viewport
                  // without "economy" wrapping mid-word. Stays huge on desktop.
                  fontSize: "clamp(2.25rem, 9vw, 3.5rem)",
                  lineHeight: 1,
                  fontWeight: 800,
                  letterSpacing: "-0.03em",
                  margin: 0,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  color: "hsl(var(--foreground))",
                  overflowWrap: "anywhere",
                }}
              >
                <PepIcon size={44} /> PEP economy
              </h1>
              <p
                style={{
                  color: "hsl(var(--muted-foreground))",
                  margin: "10px 0 0",
                  fontSize: 16,
                }}
              >
                Welcome,{" "}
                <span style={{ color: "hsl(var(--foreground))", fontWeight: 600 }}>
                  {memberName || session.username || session.discordId}
                </span>
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <NotificationBell />
              <Link href="/" style={{ ...btn("secondary"), fontSize: 14 }}>
                ← Home
              </Link>
            </div>
          </div>
        </header>

        {/* Under construction warning */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 16px",
            marginBottom: 24,
            borderRadius: "var(--radius)",
            border: "1px solid hsl(var(--butter) / 0.55)",
            background: "hsl(var(--butter) / 0.18)",
            color: "hsl(var(--ink))",
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          <span style={{ fontSize: 20 }}>🚧</span>
          <span>
            This page is under construction. Features may be incomplete or change without notice.
          </span>
        </div>

        {/*
          sicilian-41551: was a fixed two-column grid (1.2fr 1fr) which forced
          two columns to share ~155px each at 375px wide and broke. The
          className uses Tailwind to stack on mobile (<lg) and run side-by-side
          on >=lg. The nested 1fr-1fr leaderboard/wallet row gets the same
          treatment.
        */}
        <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
          {/* Left: Jobs and Bounties */}
          <div>
            <JobBoard onJobCompleted={refreshWallet} />
            <BountyBoard
              currentUserId={session.discordId || ""}
              onBountyAction={refreshWallet}
            />
          </div>

          {/* Right: Leaderboard, Balance, Inventory, Shop stacked */}
          <div style={{ display: "grid", gap: 20, alignContent: "start" }}>
            {/* Top row: Leaderboard and Balance side by side on >=sm */}
            <div className="grid gap-5 sm:grid-cols-2">
              <Leaderboard />
              <div style={{ display: "grid", gap: 20, alignContent: "start" }}>
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

            {/* Shop below */}
            <div style={card()}>
              <h2
                style={{
                  fontFamily: DISPLAY_FONT,
                  fontSize: 22,
                  fontWeight: 700,
                  letterSpacing: "-0.01em",
                  margin: 0,
                  color: "hsl(var(--foreground))",
                }}
              >
                Shop
              </h2>
              <ShopGrid key={`shop-${walletKey}`} onPurchase={refreshWallet} />
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
