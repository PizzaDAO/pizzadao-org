"use client";

import React, { useState, type CSSProperties } from "react";
import { formatPep } from "../economy/PepIcon";
import { UserLink } from "../UserLink";
import { BountyComments } from "./BountyComments";
import { useTranslations } from "next-intl";
import { card as cardBase, btn, badge, input } from "../shared-styles";
import { DiscordText } from "../shared/DiscordText";

type BountyStatus = "OPEN" | "CLAIMED" | "SUBMITTED";

type Bounty = {
  id: number;
  description: string;
  link: string | null;
  reward: number;
  createdBy: string;
  claimedBy: string | null;
  status: BountyStatus;
  submissionNote?: string | null;
  submissionLink?: string | null;
  reviewNote?: string | null;
  commentCount?: number;
  crewId?: string | null;
  crewLabel?: string | null;
};

type BountyCardProps = {
  bounty: Bounty;
  currentUserId: string;
  onAction?: () => void;
  /** channel/role id -> name maps resolved server-side, and the guild id for channel links */
  channels?: Record<string, string>;
  roles?: Record<string, string>;
  guildId?: string | null;
};

function cardStyle(status: BountyStatus): CSSProperties {
  const base = cardBase();
  if (status === "CLAIMED" || status === "SUBMITTED") {
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
function statusBadge(status: BountyStatus): CSSProperties {
  const base = badge("default");
  if (status === "CLAIMED" || status === "SUBMITTED") {
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

export function BountyCard({ bounty, currentUserId, onAction, channels, roles, guildId }: BountyCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showComments, setShowComments] = useState(false);
  const t = useTranslations("bounties");
  const [formKind, setFormKind] = useState<"submit" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const [proof, setProof] = useState("");

  const isCreator = bounty.createdBy === currentUserId;
  const isClaimer = bounty.claimedBy === currentUserId;
  const canComment = isCreator || isClaimer;

  const post = async (path: string, extra?: Record<string, unknown>) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bountyId: bounty.id, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setFormKind(null);
      setNote("");
      setProof("");
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
              {bounty.status === "SUBMITTED" ? t("awaitingReview") : bounty.status === "CLAIMED" ? "In Progress" : "Open"}
            </span>
            <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>
              #{bounty.id}
            </span>
            {bounty.crewId && (
              <a
                href={`/crew/${bounty.crewId}`}
                style={{ ...badge(), textDecoration: "none" }}
                data-testid="bounty-crew-tag"
              >
                {bounty.crewLabel || bounty.crewId}
              </a>
            )}
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
            <DiscordText text={bounty.description} channels={channels} roles={roles} guildId={guildId} />
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
          {(bounty.status === "CLAIMED" || bounty.status === "SUBMITTED") && bounty.claimedBy && (
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
          {bounty.status === "SUBMITTED" && (bounty.submissionNote || bounty.submissionLink) && (
            <div
              style={{
                marginTop: 8,
                padding: "6px 10px",
                background: "hsl(var(--butter) / 0.15)",
                border: "1px solid hsl(var(--butter) / 0.40)",
                borderRadius: "var(--radius)",
                fontSize: 12,
                display: "grid",
                gap: 4,
              }}
            >
              <strong>{t("submission")}</strong>
              {bounty.submissionNote && (
                <span style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{bounty.submissionNote}</span>
              )}
              {bounty.submissionLink && /^https:\/\//i.test(bounty.submissionLink) && (
                <a
                  href={bounty.submissionLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "hsl(var(--tomato))", wordBreak: "break-all" }}
                >
                  {t("viewProof")}
                </a>
              )}
            </div>
          )}
          {bounty.status === "CLAIMED" && bounty.reviewNote && (
            <div
              style={{
                marginTop: 8,
                padding: 8,
                background: "hsl(var(--tomato) / 0.06)",
                border: "1px solid hsl(var(--tomato) / 0.30)",
                borderRadius: "var(--radius)",
                color: "hsl(var(--tomato))",
                fontSize: 12,
                overflowWrap: "anywhere",
              }}
            >
              {t("sentBack", { note: bounty.reviewNote })}
            </div>
          )}
          {formKind && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!note.trim()) return;
                if (formKind === "submit") {
                  void post("/api/bounties/submit", { note, ...(proof.trim() ? { link: proof.trim() } : {}) });
                } else {
                  void post("/api/bounties/reject", { note });
                }
              }}
              style={{ marginTop: 8, display: "grid", gap: 8 }}
            >
              <textarea
                required
                maxLength={2000}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={formKind === "submit" ? t("submitNotePlaceholder") : t("rejectNotePlaceholder")}
                style={{ ...input(), minHeight: 64, resize: "vertical" }}
              />
              {formKind === "submit" && (
                <input
                  type="url"
                  value={proof}
                  onChange={(e) => setProof(e.target.value)}
                  placeholder={t("submitLinkPlaceholder")}
                  style={input()}
                />
              )}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="submit"
                  disabled={loading || !note.trim()}
                  style={{ ...btn("accent", loading || !note.trim()), padding: "6px 14px", fontSize: 13 }}
                >
                  {loading ? "..." : formKind === "submit" ? t("send") : t("rejectSend")}
                </button>
                <button
                  type="button"
                  onClick={() => setFormKind(null)}
                  style={{ ...btn("secondary", false), padding: "6px 14px", fontSize: 13 }}
                >
                  {t("close")}
                </button>
              </div>
            </form>
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
            data-testid="bounty-reward"
            style={{
              fontSize: 18,
              fontWeight: 900,
              color: "hsl(var(--tomato))",
              fontFamily:
                "var(--font-display), var(--font-sans), system-ui, sans-serif",
              letterSpacing: "-0.01em",
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            {formatPep(bounty.reward)}
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
              onClick={() => {
                setFormKind("submit");
                setNote("");
                setProof("");
              }}
              disabled={loading}
              style={{
                ...btn("accent", loading),
                padding: "6px 14px",
                fontSize: 13,
              }}
            >
              {t("submitWork")}
            </button>
          )}

          {(bounty.status === "CLAIMED" || bounty.status === "SUBMITTED") && isClaimer && (
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

          {(bounty.status === "CLAIMED" || bounty.status === "SUBMITTED") && isCreator && (
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
              {bounty.status === "SUBMITTED" && (
                <button
                  onClick={() => {
                    setFormKind("reject");
                    setNote("");
                  }}
                  disabled={loading}
                  style={{
                    ...btn("secondary", loading),
                    padding: "4px 12px",
                    fontSize: 11,
                  }}
                >
                  {t("reject")}
                </button>
              )}
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
