"use client";

import React, { useState, type CSSProperties } from "react";
import { PepAmount } from "../economy/PepIcon";
import { UserLink } from "../UserLink";
import { BountyComments } from "./BountyComments";
import { card as cardBase, btn, badge } from "../shared-styles";

type Bounty = {
  id: number;
  description: string;
  link: string | null;
  reward: number;
  createdBy: string;
  claimedBy: string | null;
  status: "OPEN" | "CLAIMED";
  commentCount?: number;
};

type BountyCardProps = {
  bounty: Bounty;
  currentUserId: string;
  onAction?: () => void;
};

function cardStyle(status: "OPEN" | "CLAIMED"): CSSProperties {
  const base = cardBase();
  if (status === "CLAIMED") {
    return {
      ...base,
      padding: 18,
      gap: 0,
      borderColor: "hsl(var(--butter) / 0.50)",
      background: "hsl(var(--butter) / 0.08)",
    };
  }
  return { ...base, padding: 18, gap: 0 };
}

// Status pill colors per spec:
//   open = emerald
//   in-progress (CLAIMED) = butter
//   closed = muted
//   expired = tomato
function statusBadge(status: "OPEN" | "CLAIMED"): CSSProperties {
  const base = badge("default");
  if (status === "CLAIMED") {
    return {
      ...base,
      background: "hsl(var(--butter) / 0.20)",
      color: "hsl(38 90% 28%)",
      borderColor: "hsl(var(--butter) / 0.55)",
    };
  }
  return {
    ...base,
    background: "hsl(142 71% 35% / 0.12)",
    color: "hsl(142 71% 28%)",
    borderColor: "hsl(142 71% 35% / 0.35)",
  };
}

export function BountyCard({ bounty, currentUserId, onAction }: BountyCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showComments, setShowComments] = useState(false);

  const isCreator = bounty.createdBy === currentUserId;
  const isClaimer = bounty.claimedBy === currentUserId;
  const canComment = isCreator || isClaimer;

  const post = async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bountyId: bounty.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onAction?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={cardStyle(bounty.status)}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        {/* Left side - content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 6,
              flexWrap: "wrap",
            }}
          >
            <span style={statusBadge(bounty.status)}>
              {bounty.status === "CLAIMED" ? "In Progress" : "Open"}
            </span>
            <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
              #{bounty.id}
            </span>
            {isCreator && (
              <span style={badge("accent")}>Your Bounty</span>
            )}
          </div>
          <p
            style={{
              fontSize: 14,
              margin: 0,
              lineHeight: 1.45,
              color: "hsl(var(--foreground))",
            }}
          >
            {bounty.description}
          </p>
          {bounty.link && (
            <a
              href={bounty.link}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                marginTop: 6,
                fontSize: 12,
                color: "hsl(var(--tomato))",
                textDecoration: "none",
              }}
            >
              <svg
                width={12}
                height={12}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              View details
            </a>
          )}
          <div
            style={{
              marginTop: 8,
              fontSize: 12,
              color: "hsl(var(--muted-foreground))",
            }}
          >
            Posted by <UserLink discordId={bounty.createdBy} />
          </div>
          {bounty.status === "CLAIMED" && bounty.claimedBy && (
            <div
              style={{
                marginTop: 8,
                padding: "6px 10px",
                background: "hsl(var(--butter) / 0.15)",
                border: "1px solid hsl(var(--butter) / 0.40)",
                borderRadius: "var(--radius)",
                fontSize: 12,
                display: "flex",
                alignItems: "center",
                gap: 6,
                flexWrap: "wrap",
              }}
            >
              <span style={{ color: "hsl(var(--muted-foreground))" }}>
                Claimed by:
              </span>
              <UserLink discordId={bounty.claimedBy} />
              {isClaimer && (
                <span style={{ color: "hsl(142 71% 30%)", fontWeight: 600 }}>
                  (You)
                </span>
              )}
            </div>
          )}
          {error && (
            <div
              style={{
                marginTop: 8,
                padding: 8,
                background: "hsl(var(--tomato) / 0.06)",
                border: "1px solid hsl(var(--tomato) / 0.30)",
                borderRadius: "var(--radius)",
                color: "hsl(var(--tomato))",
                fontSize: 12,
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* Right side - reward and actions */}
        <div
          style={{
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 10,
          }}
        >
          <div
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: "hsl(var(--tomato))",
              fontFamily:
                "var(--font-display), var(--font-sans), system-ui, sans-serif",
              letterSpacing: "-0.01em",
              display: "flex",
              alignItems: "center",
            }}
          >
            <PepAmount amount={bounty.reward} size={20} />
          </div>

          {/* Action buttons */}
          {bounty.status === "OPEN" && !isCreator && (
            <button
              onClick={() => post("/api/bounties/claim")}
              disabled={loading}
              style={{
                ...btn("accent", loading),
                padding: "6px 14px",
                fontSize: 13,
              }}
            >
              {loading ? "..." : "Claim"}
            </button>
          )}

          {bounty.status === "OPEN" && isCreator && (
            <button
              onClick={() => post("/api/bounties/cancel")}
              disabled={loading}
              style={{
                ...btn("secondary", loading),
                padding: "6px 14px",
                fontSize: 13,
                color: "hsl(var(--tomato))",
                borderColor: "hsl(var(--tomato) / 0.40)",
              }}
            >
              {loading ? "..." : "Cancel"}
            </button>
          )}

          {bounty.status === "CLAIMED" && isClaimer && (
            <button
              onClick={() => post("/api/bounties/giveup")}
              disabled={loading}
              style={{
                ...btn("secondary", loading),
                padding: "6px 14px",
                fontSize: 13,
              }}
            >
              {loading ? "..." : "Give Up"}
            </button>
          )}

          {bounty.status === "CLAIMED" && isCreator && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button
                onClick={() => post("/api/bounties/complete")}
                disabled={loading}
                style={{
                  ...btn("accent", loading),
                  padding: "6px 14px",
                  fontSize: 13,
                }}
              >
                {loading ? "..." : "Approve"}
              </button>
              <button
                onClick={() => post("/api/bounties/cancel")}
                disabled={loading}
                style={{
                  ...btn("secondary", loading),
                  padding: "4px 12px",
                  fontSize: 11,
                  color: "hsl(var(--tomato))",
                  borderColor: "hsl(var(--tomato) / 0.40)",
                }}
              >
                {loading ? "..." : "Cancel"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Comments toggle and section */}
      <div
        style={{
          marginTop: 12,
          borderTop: "1px solid hsl(var(--rule) / 0.12)",
          paddingTop: 10,
        }}
      >
        <button
          onClick={() => setShowComments(!showComments)}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 12,
            color: "hsl(var(--muted-foreground))",
            padding: 0,
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontWeight: 600,
          }}
        >
          <svg
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {showComments ? "Hide" : "Updates"}
          {(bounty.commentCount ?? 0) > 0 && (
            <span
              style={{
                ...badge("accent"),
                padding: "1px 8px",
                fontSize: 10,
              }}
            >
              {bounty.commentCount}
            </span>
          )}
        </button>

        {showComments && (
          <BountyComments
            bountyId={bounty.id}
            currentUserId={currentUserId}
            canComment={canComment}
          />
        )}
      </div>
    </div>
  );
}
