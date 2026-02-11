"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { Leaderboard, PepIcon, PepAmount, TransactionHistory } from "../ui/economy";
import { JobBoard } from "../ui/jobs";
import { ShopGrid } from "../ui/shop";
import { BountyBoard } from "../ui/bounties";
import { NotificationBell } from "../ui/notifications";

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

function card(): React.CSSProperties {
  return {
    border: '1px solid var(--color-border)',
    borderRadius: 14,
    padding: 20,
    boxShadow: 'var(--shadow-card)',
    background: 'var(--color-surface)',
  };
}

function btn(kind: "primary" | "secondary"): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "inline-block",
    padding: "10px 16px",
    borderRadius: 10,
    border: '1px solid var(--color-border-strong)',
    fontWeight: 650,
    cursor: "pointer",
    textDecoration: "none",
    textAlign: "center",
  };
  if (kind === "primary") return { ...base, background: 'var(--color-btn-primary-bg)', color: 'var(--color-btn-primary-text)', borderColor: 'var(--color-btn-primary-border)' };
  return { ...base, background: 'var(--color-surface)', color: 'var(--color-text)' };
}

function input(): React.CSSProperties {
  return {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: '1px solid var(--color-border-strong)',
    fontSize: 14,
    outline: "none",
    boxSizing: "border-box" as const,
  };
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

  return (
    <div style={{
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'var(--color-overlay)',
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1000,
    }} onClick={onClose}>
      <div style={{ ...card(), maxWidth: 400, width: "90%" }} onClick={e => e.stopPropagation()}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 0, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
          Send {type === "pep" ? <><PepIcon size={18} /></> : itemName}
        </h2>

        {error && (
          <div style={{ marginBottom: 16, padding: 12, background: "rgba(255,0,0,0.05)", borderRadius: 8, color: "var(--color-danger)", fontSize: 14 }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSend} style={{ display: "grid", gap: 16 }}>
          <div>
            <label style={{ display: "block", fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
              Recipient Member ID
            </label>
            <input
              type="text"
              placeholder="Enter member ID"
              value={memberId}
              onChange={(e) => setMemberId(e.target.value)}
              style={input()}
              disabled={loading}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
              Amount {maxQuantity && `(max: ${maxQuantity})`}
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
            />
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" onClick={onClose} style={{ ...btn("secondary"), flex: 1 }}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !memberId || !amount}
              style={{ ...btn("primary"), flex: 1, opacity: loading || !memberId || !amount ? 0.5 : 1 }}
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
        color: 'var(--color-text-secondary)',
        transition: "color 0.2s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-text)")}
      onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-text-secondary)")}
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
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, marginBottom: 16 }}>Your Balance</h2>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 20, background: 'var(--color-page-bg)', borderRadius: 10 }}>
        {loading ? (
          <div style={{ height: 38, flex: 1, background: 'var(--color-surface-hover)', borderRadius: 8 }} />
        ) : (
          <>
            <div style={{ fontSize: 32, fontWeight: 700, color: "#16a34a", flex: 1 }}>
              <PepAmount amount={balance ?? 0} size={32} />
            </div>
            <SendIcon size={20} onClick={onSendClick} />
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

  if (loading) {
    return (
      <div style={card()}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, marginBottom: 16 }}>Your Inventory</h2>
        <div style={{ height: 60, background: 'var(--color-surface-hover)', borderRadius: 8 }} />
      </div>
    );
  }

  return (
    <div style={card()}>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, marginBottom: 16 }}>Your Inventory</h2>
      {items.length === 0 ? (
        <p style={{ color: 'var(--color-text-secondary)', textAlign: "center", padding: "16px 0", margin: 0 }}>No items yet</p>
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
                background: 'var(--color-page-bg)',
                borderRadius: 10,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {inv.item.image && (
                  <img src={inv.item.image} alt={inv.item.name} style={{ width: 32, height: 32, borderRadius: 6 }} />
                )}
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{inv.item.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>x{inv.quantity}</div>
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
  const [session, setSession] = useState<SessionData | null>(null);
  const [memberName, setMemberName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [walletKey, setWalletKey] = useState(0);
  const [sendModal, setSendModal] = useState<{
    type: "pep" | "item";
    itemName?: string;
    itemId?: number;
    maxQuantity?: number;
  } | null>(null);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const res = await fetch("/api/me");
        const data = await res.json();
        setSession(data);

        // Fetch member name if authenticated
        if (data.authenticated && data.discordId) {
          try {
            const memberRes = await fetch(`/api/member-lookup/${data.discordId}`);
            if (memberRes.ok) {
              const memberData = await memberRes.json();
              if (memberData.memberName) {
                setMemberName(memberData.memberName);
              }
            }
          } catch {
            // Ignore - fallback to username
          }
        }
      } catch {
        setSession({ authenticated: false });
      } finally {
        setLoading(false);
      }
    };
    checkSession();
  }, []);

  const refreshWallet = () => {
    setWalletKey(k => k + 1);
  };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", background: 'var(--color-page-bg)', padding: "40px 20px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ ...card(), height: 200, background: 'var(--color-surface-hover)' }} />
        </div>
      </div>
    );
  }

  if (!session?.authenticated) {
    return (
      <div style={{ minHeight: "100vh", background: 'var(--color-page-bg)', padding: "40px 20px", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ ...card(), maxWidth: 400, textAlign: "center" }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 16, display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}><PepIcon size={28} /> Economy</h1>
          <p style={{ color: 'var(--color-text-secondary)', marginBottom: 24 }}>
            Please log in with Discord to access the economy features.
          </p>
          <button onClick={() => { (window.top || window).location.href = '/api/discord/login' }} style={btn("primary")}>
            Login with Discord
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: 'var(--color-page-bg)', padding: "40px 20px" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <header style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
            <div>
              <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                <PepIcon size={28} /> Economy
              </h1>
              <p style={{ color: 'var(--color-text-secondary)', margin: 0 }}>
                Welcome, {memberName || session.username || session.discordId}
              </p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <NotificationBell />
              <Link href="/" style={{ ...btn("secondary"), fontSize: 14, textDecoration: "none" }}>
                ← Home
              </Link>
            </div>
          </div>
        </header>

        {/* Two column layout - Jobs left, everything else right */}
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 20 }}>
          {/* Left: Jobs and Bounties */}
          <div>
            <JobBoard onJobCompleted={refreshWallet} />
            <BountyBoard currentUserId={session.discordId || ""} onBountyAction={refreshWallet} />
          </div>

          {/* Right: Leaderboard, Balance, Inventory, Shop stacked */}
          <div style={{ display: "grid", gap: 20, alignContent: "start" }}>
            {/* Top row: Leaderboard and Balance side by side */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
              <Leaderboard />
              <div style={{ display: "grid", gap: 20, alignContent: "start" }}>
                <WalletWithSend walletKey={walletKey} onSendClick={() => setSendModal({ type: "pep" })} />
                <InventoryWithSend
                  walletKey={walletKey}
                  onSendItem={(inv) => setSendModal({
                    type: "item",
                    itemName: inv.item.name,
                    itemId: inv.itemId,
                    maxQuantity: inv.quantity
                  })}
                />
              </div>
            </div>

            {/* Shop below */}
            <div style={card()}>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 0, marginBottom: 16 }}>Shop</h2>
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
