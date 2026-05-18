"use client";

// app/ui/economy/TransactionHistory.tsx
//
// anchovy-67435 (Restyle Phase 4d): migrated off legacy `--color-*` aliases
// onto the new semantic HSL tokens + shared `card()` primitive. Credit (incoming)
// rows use butter/emerald accent; debit (outgoing) use ink/muted. Rows are
// clickable to expand full details. See plans/site-restyle-pizzadao-org.md.

import React, { useEffect, useState, useCallback } from "react";
import { PepIcon } from "./PepIcon";
import { card } from "../shared-styles";

type TransactionData = {
  id: number;
  type: string;
  amount: number;
  balance: number;
  description: string;
  createdAt: string;
};

const DISPLAY_FONT =
  "var(--font-display), var(--font-sans), system-ui, sans-serif";

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

function getTypeIcon(type: string, isCredit: boolean): React.ReactNode {
  // Color is set by the wrapper; SVG paints with currentColor.
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
  // (isCredit reserved for future variants)
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
        Transaction history
      </h2>

      {loading ? (
        <div
          style={{
            height: 96,
            background: "hsl(var(--muted))",
            borderRadius: "var(--radius)",
          }}
        />
      ) : transactions.length === 0 ? (
        <p
          style={{
            color: "hsl(var(--muted-foreground))",
            textAlign: "center",
            padding: "24px 0",
            margin: 0,
          }}
        >
          No transactions yet. Earn, spend, or transfer some <PepIcon size={14} /> to see your history here.
        </p>
      ) : (
        <>
          <div style={{ display: "grid", gap: 0 }}>
            {transactions.map((tx) => {
              const isCredit = tx.amount > 0;
              const accentColor = isCredit ? CREDIT_COLOR : DEBIT_COLOR;
              const isOpen = expandedId === tx.id;

              return (
                <div
                  key={tx.id}
                  onClick={() => setExpandedId(isOpen ? null : tx.id)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "30px 1fr auto",
                    columnGap: 10,
                    alignItems: "center",
                    padding: "12px 4px",
                    borderBottom: "1px solid hsl(var(--rule) / 0.10)",
                    cursor: "pointer",
                    transition: "background-color 150ms ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "hsl(var(--ink) / 0.04)";
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
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: "hsl(var(--foreground))",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: isOpen ? "normal" : "nowrap",
                      }}
                    >
                      {tx.description}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "hsl(var(--muted-foreground))",
                        marginTop: 2,
                      }}
                    >
                      {isOpen ? formatAbsoluteTime(tx.createdAt) : formatRelativeTime(tx.createdAt)}
                    </div>
                    {isOpen && (
                      <div
                        style={{
                          marginTop: 6,
                          fontSize: 12,
                          color: "hsl(var(--muted-foreground))",
                          display: "grid",
                          gap: 2,
                        }}
                      >
                        <div>
                          <span style={{ fontWeight: 600 }}>Type:</span> {tx.type}
                        </div>
                        <div>
                          <span style={{ fontWeight: 600 }}>Balance after:</span>{" "}
                          {tx.balance.toLocaleString()} PEP
                        </div>
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      fontFamily: DISPLAY_FONT,
                      fontSize: 16,
                      fontWeight: 700,
                      color: accentColor,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {isCredit ? "+" : ""}
                    {tx.amount.toLocaleString()}
                    <PepIcon size={13} />
                  </div>
                </div>
              );
            })}
          </div>

          {hasMore && (
            <button
              onClick={handleLoadMore}
              disabled={loadingMore}
              style={{
                display: "block",
                width: "100%",
                marginTop: 12,
                padding: "10px 0",
                background: "hsl(var(--secondary))",
                color: "hsl(var(--secondary-foreground))",
                border: "1px solid hsl(var(--rule) / 0.22)",
                borderRadius: "var(--radius)",
                fontSize: 13,
                fontWeight: 600,
                cursor: loadingMore ? "default" : "pointer",
                opacity: loadingMore ? 0.5 : 1,
                fontFamily: DISPLAY_FONT,
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
