"use client";

// app/ui/economy/TransactionHistory.tsx
//
// capricciosa-35929 — Editorial restyle. Dossier-style ledger with overline
// date headers, hairline rules between rows, and a hand-stamped "SENT" seal
// on outgoing transfers. API contract unchanged — still calls GET
// /api/economy/history with the same pagination params; rows still expand
// to show type + balance details. Credit/debit logic preserved.
//
// anchovy-67435 (Restyle Phase 4d): semantic HSL tokens.

import React, { useEffect, useState, useCallback } from "react";
import { PepIcon } from "./PepIcon";

type TransactionData = {
  id: number;
  type: string;
  amount: number;
  balance: number;
  description: string;
  createdAt: string;
};

const CREDIT_COLOR = "hsl(142 71% 32%)";   // emerald, used for incoming
const DEBIT_COLOR = "hsl(var(--ink-soft))"; // muted ink for outgoing

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

function formatAbsoluteTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString();
}

function formatDateHeader(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const dDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (dDay.getTime() === today.getTime()) return "Today";
  if (dDay.getTime() === yesterday.getTime()) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

function dateKey(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function getTypeIcon(type: string, isCredit: boolean): React.ReactNode {
  switch (type) {
    case "TRANSFER_SENT":
    case "TRANSFER_RECEIVED":
      return (
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 2L11 13" />
          <path d="M22 2L15 22L11 13L2 9L22 2Z" />
        </svg>
      );
    case "SHOP_PURCHASE":
      return (
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="9" cy="21" r="1" />
          <circle cx="20" cy="21" r="1" />
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
        </svg>
      );
    case "JOB_REWARD":
      return (
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
        </svg>
      );
    case "BOUNTY_ESCROW":
    case "BOUNTY_REWARD":
    case "BOUNTY_REFUND":
      return (
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="7" />
          <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
        </svg>
      );
    default:
      return (
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="1" x2="12" y2="23" />
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
      );
  }
  void isCredit;
}

const PAGE_SIZE = 20;

export function TransactionHistory({ refreshKey }: { refreshKey?: number }) {
  const [transactions, setTransactions] = useState<TransactionData[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const fetchTransactions = useCallback(async (offset = 0, append = false) => {
    try {
      const res = await fetch(`/api/economy/history?limit=${PAGE_SIZE}&offset=${offset}`);
      if (!res.ok) return;
      const data = await res.json();
      if (append) {
        setTransactions((prev) => [...prev, ...data.transactions]);
      } else {
        setTransactions(data.transactions);
      }
      setTotal(data.total);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchTransactions(0, false).finally(() => setLoading(false));
  }, [fetchTransactions, refreshKey]);

  const handleLoadMore = async () => {
    setLoadingMore(true);
    await fetchTransactions(transactions.length, true);
    setLoadingMore(false);
  };

  const hasMore = transactions.length < total;

  // Group transactions by date for the editorial dossier headers
  const grouped = (() => {
    const groups: { key: string; label: string; rows: TransactionData[] }[] = [];
    let lastKey = "";
    for (const tx of transactions) {
      const k = dateKey(tx.createdAt);
      if (k !== lastKey) {
        groups.push({
          key: k,
          label: formatDateHeader(tx.createdAt),
          rows: [],
        });
        lastKey = k;
      }
      groups[groups.length - 1]!.rows.push(tx);
    }
    return groups;
  })();

  return (
    <div
      className="paper-soft relative overflow-hidden rounded-[24px] border p-6 md:p-7"
      style={{
        background: "hsl(var(--card))",
        borderColor: "hsl(var(--rule-warm) / 0.55)",
        boxShadow: "var(--shadow-soft)",
      }}
    >
      <div className="relative flex items-start justify-between gap-4">
        <p className="overline text-tomato">§ ··· Dossier</p>
        <span
          className="handwritten -rotate-[5deg]"
          style={{
            fontSize: 14,
            color: "hsl(var(--foreground) / 0.5)",
          }}
        >
          every move logged
        </span>
      </div>

      <h2
        className="font-[family-name:var(--font-display)] relative mt-2 font-black tracking-[-0.02em] text-foreground"
        style={{
          fontSize: "clamp(1.6rem, 3.5vw, 2.25rem)",
          lineHeight: 0.95,
        }}
      >
        Transaction history
      </h2>

      {loading ? (
        <div
          className="relative mt-5"
          style={{
            height: 96,
            background: "hsl(var(--muted))",
            borderRadius: "var(--radius)",
          }}
        />
      ) : transactions.length === 0 ? (
        <p
          className="relative mt-6 text-center"
          style={{
            color: "hsl(var(--muted-foreground))",
            padding: "24px 0",
            margin: 0,
          }}
        >
          No transactions yet. Earn, spend, or transfer some{" "}
          <PepIcon size={14} /> to see your history here.
        </p>
      ) : (
        <>
          <div className="rule-warm relative mt-5" />

          <div className="relative mt-2 grid gap-0">
            {grouped.map((group) => (
              <div key={group.key} className="relative">
                <p
                  className="overline mt-4 mb-2 text-foreground/55"
                  style={{ paddingLeft: 4 }}
                >
                  {group.label}
                </p>
                <div className="grid">
                  {group.rows.map((tx) => {
                    const isCredit = tx.amount > 0;
                    const accentColor = isCredit ? CREDIT_COLOR : DEBIT_COLOR;
                    const isOpen = expandedId === tx.id;
                    const isOutgoing = tx.type === "TRANSFER_SENT";

                    return (
                      <div
                        key={tx.id}
                        onClick={() => setExpandedId(isOpen ? null : tx.id)}
                        className="relative cursor-pointer transition-colors"
                        style={{
                          display: "grid",
                          gridTemplateColumns: "30px 1fr auto",
                          columnGap: 12,
                          alignItems: "center",
                          padding: "12px 4px",
                          borderBottom:
                            "1px dashed hsl(var(--rule-warm) / 0.55)",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background =
                            "hsl(var(--ink) / 0.03)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "transparent";
                        }}
                      >
                        <div
                          style={{
                            width: 30,
                            height: 30,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            borderRadius: "50%",
                            background: isCredit
                              ? "hsl(142 71% 32% / 0.12)"
                              : "hsl(var(--ink) / 0.06)",
                            color: accentColor,
                          }}
                        >
                          {getTypeIcon(tx.type, isCredit)}
                        </div>

                        <div style={{ minWidth: 0 }}>
                          <div
                            className="font-[family-name:var(--font-display)] font-black tracking-tight"
                            style={{
                              fontSize: 15,
                              color: "hsl(var(--foreground))",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: isOpen ? "normal" : "nowrap",
                              lineHeight: 1.15,
                            }}
                          >
                            {tx.description}
                          </div>
                          <div
                            className="ui mt-1 text-[10px] uppercase tracking-[0.22em]"
                            style={{
                              color: "hsl(var(--muted-foreground))",
                            }}
                          >
                            {isOpen
                              ? formatAbsoluteTime(tx.createdAt)
                              : formatRelativeTime(tx.createdAt)}
                          </div>
                          {isOpen && (
                            <div
                              className="mt-2 grid gap-1 text-[12px]"
                              style={{
                                color: "hsl(var(--muted-foreground))",
                              }}
                            >
                              <div>
                                <span style={{ fontWeight: 600 }}>Type:</span>{" "}
                                {tx.type}
                              </div>
                              <div>
                                <span style={{ fontWeight: 600 }}>
                                  Balance after:
                                </span>{" "}
                                {tx.balance.toLocaleString()} PEP
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="relative flex items-center gap-2">
                          {isOutgoing && (
                            <span
                              aria-hidden
                              className="ui hidden md:inline-flex"
                              style={{
                                transform: "rotate(-8deg)",
                                border: "1.5px solid hsl(var(--tomato) / 0.75)",
                                color: "hsl(var(--tomato))",
                                background: "hsl(var(--tomato) / 0.06)",
                                padding: "2px 7px",
                                borderRadius: 4,
                                fontSize: 10,
                                fontWeight: 700,
                                letterSpacing: "0.22em",
                                textTransform: "uppercase",
                                opacity: 0.85,
                              }}
                            >
                              Sent
                            </span>
                          )}
                          <span
                            className="font-[family-name:var(--font-display)] font-black tracking-tight whitespace-nowrap"
                            style={{
                              fontSize: 17,
                              color: accentColor,
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                          >
                            {isCredit ? "+" : ""}
                            {tx.amount.toLocaleString()}
                            <PepIcon size={13} />
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {hasMore && (
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="btn-pill mt-5"
              style={{
                background: "hsl(var(--secondary))",
                color: "hsl(var(--secondary-foreground))",
                border: "1px solid hsl(var(--rule-warm) / 0.55)",
                width: "100%",
                opacity: loadingMore ? 0.5 : 1,
                cursor: loadingMore ? "default" : "pointer",
              }}
            >
              {loadingMore ? "Loading..." : "Load more"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
