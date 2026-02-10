"use client";

import React, { useState } from "react";
import { PepAmount } from "../economy/PepIcon";
import { UserLink } from "../UserLink";
import { BountyComments } from "./BountyComments";

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

function card(status: "OPEN" | "CLAIMED"): React.CSSProperties {
  return {
    border: status === "CLAIMED" ? "1px solid rgba(234,179,8,0.3)" : "1px solid var(--color-border)",
    borderRadius: 14,
    padding: 16,
    boxShadow: 'var(--shadow-card)',
    background: status === "CLAIMED" ? "rgba(234,179,8,0.05)" : "var(--color-surface)",
  };
}

function btn(variant: "primary" | "secondary" | "danger"): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: "6px 12px",
    borderRadius: 6,
    border: "none",
    fontWeight: 650,
    cursor: "pointer",
    fontSize: 12,
    whiteSpace: "nowrap" as const,
  };
  if (variant === "primary") return { ...base, background: 'var(--color-btn-primary-bg)', color: 'var(--color-btn-primary-text)' };
  if (variant === "danger") return { ...base, background: "#dc2626", color: 'var(--color-btn-primary-text)' };
  return { ...base, background: "var(--color-surface-hover)", color: 'var(--color-text)' };
}

export function BountyCard({ bounty, currentUserId, onAction }: BountyCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showComments, setShowComments] = useState(false);

  const isCreator = bounty.createdBy === currentUserId;
  const isClaimer = bounty.claimedBy === currentUserId;
  const canComment = isCreator || isClaimer;

  const handleClaim = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/bounties/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bountyId: bounty.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onAction?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to claim bounty");
    } finally {
      setLoading(false);
    }
  };

  const handleGiveUp = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/bounties/giveup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bountyId: bounty.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onAction?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to give up bounty");
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/bounties/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bountyId: bounty.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onAction?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete bounty");
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/bounties/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bountyId: bounty.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onAction?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel bounty");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={card(bounty.status)}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        {/* Left side - content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "3px 6px",
              background: bounty.status === "CLAIMED" ? "rgba(234,179,8,0.1)" : "rgba(139,92,246,0.1)",
              color: bounty.status === "CLAIMED" ? "#ca8a04" : "#8b5cf6",
              borderRadius: 4,
            }}>
              {bounty.status === "CLAIMED" ? "In Progress" : "Open"}
            </span>
            <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>#{bounty.id}</span>
            {isCreator && (
              <span style={{
                fontSize: 10,
                fontWeight: 600,
                padding: "3px 6px",
                background: "rgba(37,99,235,0.1)",
                color: "#2563eb",
                borderRadius: 4,
              }}>
                Your Bounty
              </span>
            )}
          </div>
          <p style={{ fontSize: 13, margin: 0, lineHeight: 1.4 }}>{bounty.description}</p>
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
                color: "#2563eb",
                textDecoration: "none",
              }}
            >
              <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
              View details
            </a>
          )}
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--color-text-secondary)' }}>
            Posted by <UserLink discordId={bounty.createdBy} />
          </div>
          {bounty.status === "CLAIMED" && bounty.claimedBy && (
            <div style={{
              marginTop: 8,
              padding: "6px 10px",
              background: "rgba(234,179,8,0.1)",
              borderRadius: 6,
              fontSize: 12,
              display: "flex",
              alignItems: "center",
              gap: 6
            }}>
              <span style={{ color: 'var(--color-text-secondary)' }}>Claimed by:</span>
              <UserLink discordId={bounty.claimedBy} />
              {isClaimer && <span style={{ color: "#16a34a", fontWeight: 600 }}>(You)</span>}
            </div>
          )}
          {error && (
            <div style={{ marginTop: 8, padding: 6, background: "rgba(255,0,0,0.05)", borderRadius: 4, color: "#c00", fontSize: 11 }}>
              {error}
            </div>
          )}
        </div>

        {/* Right side - reward and actions */}
        <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
          <div style={{
            padding: "6px 10px",
            background: "rgba(139,92,246,0.1)",
            borderRadius: 6,
            color: "#8b5cf6",
            fontWeight: 700,
            fontSize: 12,
          }}>
            <PepAmount amount={bounty.reward} size={12} />
          </div>

          {/* Action buttons */}
          {bounty.status === "OPEN" && !isCreator && (
            <button
              onClick={handleClaim}
              disabled={loading}
              style={{ ...btn("primary"), opacity: loading ? 0.5 : 1 }}
            >
              {loading ? "..." : "Claim"}
            </button>
          )}

          {bounty.status === "OPEN" && isCreator && (
            <button
              onClick={handleCancel}
              disabled={loading}
              style={{ ...btn("danger"), opacity: loading ? 0.5 : 1 }}
            >
              {loading ? "..." : "Cancel"}
            </button>
          )}

          {bounty.status === "CLAIMED" && isClaimer && (
            <button
              onClick={handleGiveUp}
              disabled={loading}
              style={{ ...btn("secondary"), opacity: loading ? 0.5 : 1 }}
            >
              {loading ? "..." : "Give Up"}
            </button>
          )}

          {bounty.status === "CLAIMED" && isCreator && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <button
                onClick={handleComplete}
                disabled={loading}
                style={{ ...btn("primary"), opacity: loading ? 0.5 : 1, background: "#16a34a" }}
              >
                {loading ? "..." : "Approve"}
              </button>
              <button
                onClick={handleCancel}
                disabled={loading}
                style={{ ...btn("danger"), opacity: loading ? 0.5 : 1, fontSize: 10, padding: "4px 8px" }}
              >
                {loading ? "..." : "Cancel"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Comments toggle and section */}
      <div style={{ marginTop: 10, borderTop: '1px solid var(--color-divider)', paddingTop: 8 }}>
        <button
          onClick={() => setShowComments(!showComments)}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 12,
            color: 'var(--color-text-secondary)',
            padding: 0,
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontWeight: 500,
          }}
        >
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {showComments ? "Hide" : "Updates"}
          {(bounty.commentCount ?? 0) > 0 && (
            <span style={{
              background: "rgba(139,92,246,0.1)",
              color: "#8b5cf6",
              padding: "1px 6px",
              borderRadius: 10,
              fontSize: 10,
              fontWeight: 700,
            }}>
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
