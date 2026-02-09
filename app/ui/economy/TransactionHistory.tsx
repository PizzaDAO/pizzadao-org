"use client";

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

function getTypeIcon(type: string): { icon: React.ReactNode; color: string } {
  const isCredit = [
    "TRANSFER_RECEIVED",
    "JOB_REWARD",
    "BOUNTY_REWARD",
    "BOUNTY_REFUND",
  ].includes(type);

  const color = isCredit ? "#16a34a" : "#dc2626";

  switch (type) {
    case "TRANSFER_SENT":
    case "TRANSFER_RECEIVED":
      return {
        color,
        icon: (
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 2L11 13" />
            <path d="M22 2L15 22L11 13L2 9L22 2Z" />
          </svg>
        ),
      };
    case "SHOP_PURCHASE":
      return {
        color,
        icon: (
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="21" r="1" />
            <circle cx="20" cy="21" r="1" />
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
          </svg>
        ),
      };
    case "JOB_REWARD":
      return {
        color,
        icon: (
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
          </svg>
        ),
      };
    case "BOUNTY_ESCROW":
    case "BOUNTY_REWARD":
    case "BOUNTY_REFUND":
      return {
        color,
        icon: (
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="8" r="7" />
            <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
          </svg>
        ),
      };
    default:
      return {
        color: 'var(--color-text-secondary)',
        icon: (
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="1" x2="12" y2="23" />
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
        ),
      };
  }
}

function card(): React.CSSProperties {
  return {
    border: '1px solid var(--color-border)',
    borderRadius: 14,
    padding: 20,
    boxShadow: 'var(--shadow-card)',
    background: 'var(--color-surface)',
  };
}

const PAGE_SIZE = 20;

export function TransactionHistory({ refreshKey }: { refreshKey?: number }) {
  const [transactions, setTransactions] = useState<TransactionData[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

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
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, marginBottom: 16 }}>
        Transaction History
      </h2>

      {loading ? (
        <div style={{ height: 80, background: 'var(--color-surface-hover)', borderRadius: 8 }} />
      ) : transactions.length === 0 ? (
        <p style={{ color: 'var(--color-text-secondary)', textAlign: "center", padding: "24px 0", margin: 0 }}>
          No transactions yet. Earn, spend, or transfer some <PepIcon size={14} /> to see your history here.
        </p>
      ) : (
        <>
          <div style={{ display: "grid", gap: 0 }}>
            {transactions.map((tx) => {
              const { icon, color } = getTypeIcon(tx.type);
              const isCredit = tx.amount > 0;

              return (
                <div
                  key={tx.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 0",
                    borderBottom: '1px solid var(--color-divider)',
                  }}
                >
                  <div
                    style={{
                      flexShrink: 0,
                      width: 30,
                      height: 30,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: "50%",
                      background: `${color}15`,
                      color: color,
                    }}
                  >
                    {icon}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: 'var(--color-text-primary)',
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {tx.description}
                    </div>
                    <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
                      {formatRelativeTime(tx.createdAt)}
                    </div>
                  </div>

                  <div
                    style={{
                      flexShrink: 0,
                      fontSize: 14,
                      fontWeight: 700,
                      color: isCredit ? "#16a34a" : "#dc2626",
                      display: "flex",
                      alignItems: "center",
                      gap: 3,
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
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border-strong)',
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 650,
                color: 'var(--color-text-primary)',
                cursor: loadingMore ? "default" : "pointer",
                opacity: loadingMore ? 0.5 : 1,
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
