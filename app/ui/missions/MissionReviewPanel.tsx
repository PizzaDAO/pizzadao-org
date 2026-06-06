"use client";

// capricciosa-10448 — Editorial restyle of the admin review panel.
//
// Dossier treatment: butter-pill admin badge becomes a wax-seal-style stamp,
// each submission is a paper-soft sub-file with handwritten "for review"
// margin note. Approve / Reject CTAs become btn-pill (ink / outlined). API,
// state, and i18n unchanged.
//
// Prior: garlic-68749 (Phase 4b token migration).

import { useState, useEffect } from "react";
import { input } from "../shared-styles";

type Submission = {
  id: number;
  missionId: number;
  discordId: string;
  memberId: string | null;
  memberName: string | null;
  evidence: string | null;
  notes: string | null;
  submittedAt: string;
  mission: {
    title: string;
    level: number;
    index: number;
    description: string | null;
  };
};

const DISPLAY_FONT =
  "var(--font-display), var(--font-sans), system-ui, sans-serif";

export function MissionReviewPanel() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});
  const [processing, setProcessing] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetchPending();
  }, []);

  async function fetchPending() {
    try {
      setLoading(true);
      const res = await fetch("/api/missions/pending");
      if (!res.ok) {
        if (res.status === 403) {
          setError("admin-only");
          return;
        }
        throw new Error("Failed to fetch");
      }
      const json = await res.json();
      setSubmissions(json.submissions);
    } catch {
      setError("Failed to load pending submissions");
    } finally {
      setLoading(false);
    }
  }

  async function handleReview(completionId: number, action: "approve" | "reject") {
    setProcessing((prev) => new Set(prev).add(completionId));
    try {
      const res = await fetch("/api/missions/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          completionId,
          action,
          reviewNote: reviewNotes[completionId] || undefined,
        }),
      });

      if (!res.ok) {
        const json = await res.json();
        alert(json.error || "Review failed");
        return;
      }

      // Remove from list
      setSubmissions((prev) => prev.filter((s) => s.id !== completionId));
    } finally {
      setProcessing((prev) => {
        const next = new Set(prev);
        next.delete(completionId);
        return next;
      });
    }
  }

  // Hide entirely for non-admins (API 403).
  if (error === "admin-only") return null;
  // No flash of empty state during the initial fetch.
  if (loading) return null;

  return (
    <div
      className="paper-soft halftone-soft fade-up"
      style={{
        position: "relative",
        border: "2px solid hsl(var(--butter))",
        borderRadius: "var(--radius)",
        padding: "22px clamp(18px, 4vw, 26px)",
        boxShadow: "var(--shadow-lifted)",
        background:
          "linear-gradient(180deg, hsl(var(--cream-warm)) 0%, hsl(var(--cream)) 100%)",
        color: "hsl(var(--card-foreground))",
        display: "grid",
        gap: 18,
      }}
    >
      {/* Wax-seal style "ADMIN" stamp */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "6px 16px",
            borderRadius: 999,
            background: "hsl(var(--ink))",
            color: "hsl(var(--butter))",
            fontFamily: DISPLAY_FONT,
            fontWeight: 800,
            fontSize: 12,
            letterSpacing: "0.32em",
            textTransform: "uppercase",
            transform: "rotate(-2deg)",
            boxShadow: "var(--shadow-soft)",
            border: "2px solid hsl(var(--butter))",
          }}
          aria-hidden
        >
          ★ Admin Only ★
        </span>
        <div>
          <span
            className="overline"
            style={{ color: "hsl(var(--muted-foreground))", display: "block" }}
          >
            § Pending Reviews
          </span>
          <h3
            style={{
              margin: 0,
              fontSize: "clamp(1.35rem, 3vw, 1.75rem)",
              fontFamily: DISPLAY_FONT,
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: "-0.015em",
              color: "hsl(var(--foreground))",
            }}
          >
            <span style={{ color: "hsl(var(--tomato))" }}>{submissions.length}</span>{" "}
            on your desk
          </h3>
        </div>
      </div>

      {submissions.length === 0 ? (
        <div
          style={{
            position: "relative",
            padding: "28px clamp(18px, 4vw, 26px)",
            borderRadius: "var(--radius)",
            border: "1px dashed hsl(var(--rule-warm) / 0.75)",
            background: "hsl(var(--cream))",
            display: "grid",
            gap: 8,
            placeItems: "center",
            textAlign: "center",
          }}
        >
          <span
            aria-hidden
            className="handwritten"
            style={{
              position: "absolute",
              top: 4,
              right: 14,
              fontSize: 13,
              transform: "rotate(-7deg)",
              color: "hsl(var(--tomato) / 0.75)",
              pointerEvents: "none",
            }}
          >
            the kitchen is quiet
          </span>
          <span
            className="overline"
            style={{ color: "hsl(var(--muted-foreground))" }}
          >
            § Empty queue
          </span>
          <p
            style={{
              margin: 0,
              fontFamily: DISPLAY_FONT,
              fontWeight: 800,
              fontSize: "clamp(1.15rem, 2.6vw, 1.4rem)",
              lineHeight: 1.1,
              color: "hsl(var(--foreground))",
            }}
          >
            All caught up.
          </p>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: "hsl(var(--muted-foreground))",
              maxWidth: "44ch",
            }}
          >
            No pending submissions on the desk. Check back later when members
            file new dossiers for review.
          </p>
        </div>
      ) : (
      <div style={{ display: "grid", gap: 14 }}>
        {submissions.map((sub, idx) => {
          // Mild deterministic tilt per submission, like loose pages on a desk.
          const tilt = ((sub.id % 2 === 0 ? -1 : 1) * (0.3 + (sub.id % 3) * 0.12)).toFixed(2);
          return (
            <div
              key={sub.id}
              className="paper-soft"
              style={{
                position: "relative",
                padding: "16px 18px",
                borderRadius: "var(--radius)",
                border: "1px solid hsl(var(--rule-warm) / 0.55)",
                background: "hsl(var(--cream))",
                boxShadow: "var(--shadow-soft)",
                display: "grid",
                gap: 12,
                transform: `rotate(${tilt}deg)`,
              }}
            >
              {/* Handwritten "for review" margin note */}
              <span
                aria-hidden
                className="handwritten"
                style={{
                  position: "absolute",
                  top: 6,
                  right: 12,
                  fontSize: 13,
                  transform: "rotate(-7deg)",
                  color: "hsl(var(--tomato) / 0.75)",
                  pointerEvents: "none",
                }}
              >
                for review
              </span>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <span
                    className="overline"
                    style={{
                      color: "hsl(var(--muted-foreground))",
                      display: "block",
                      marginBottom: 4,
                    }}
                  >
                    § FILE {String(idx + 1).padStart(2, "0")} · Lv.{sub.mission.level}
                  </span>
                  <div
                    style={{
                      fontFamily: DISPLAY_FONT,
                      fontWeight: 800,
                      fontSize: "clamp(1rem, 2.2vw, 1.15rem)",
                      lineHeight: 1.2,
                      letterSpacing: "-0.01em",
                      color: "hsl(var(--foreground))",
                    }}
                  >
                    {sub.mission.title}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "hsl(var(--muted-foreground))",
                      marginTop: 4,
                    }}
                  >
                    submitted by{" "}
                    <span style={{ fontWeight: 600, color: "hsl(var(--foreground))" }}>
                      {sub.memberName ?? sub.discordId}
                    </span>{" "}
                    ·{" "}
                    {new Date(sub.submittedAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              </div>

              {sub.evidence && (
                <div
                  style={{
                    fontSize: 13,
                    color: "hsl(var(--foreground))",
                    padding: "8px 10px",
                    background: "hsl(var(--butter) / 0.12)",
                    borderLeft: "2px solid hsl(var(--butter))",
                    borderRadius: 4,
                  }}
                >
                  <span
                    className="overline"
                    style={{
                      display: "block",
                      marginBottom: 2,
                      color: "hsl(var(--ink) / 0.65)",
                    }}
                  >
                    § Evidence
                  </span>
                  {sub.evidence.startsWith("http") ? (
                    <a
                      href={sub.evidence}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        color: "hsl(var(--tomato))",
                        textDecoration: "underline",
                        wordBreak: "break-all",
                      }}
                    >
                      {sub.evidence}
                    </a>
                  ) : (
                    sub.evidence
                  )}
                </div>
              )}

              {sub.notes && (
                <div
                  style={{
                    fontSize: 13,
                    color: "hsl(var(--foreground))",
                    padding: "8px 10px",
                    background: "hsl(var(--ink) / 0.04)",
                    borderLeft: "2px solid hsl(var(--ink) / 0.4)",
                    borderRadius: 4,
                  }}
                >
                  <span
                    className="overline"
                    style={{
                      display: "block",
                      marginBottom: 2,
                      color: "hsl(var(--ink) / 0.65)",
                    }}
                  >
                    § Notes
                  </span>
                  {sub.notes}
                </div>
              )}

              <div
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  flexWrap: "wrap",
                  marginTop: 4,
                  paddingTop: 10,
                  borderTop: "1px dashed hsl(var(--rule-warm) / 0.55)",
                }}
              >
                <input
                  type="text"
                  value={reviewNotes[sub.id] || ""}
                  onChange={(e) =>
                    setReviewNotes((prev) => ({ ...prev, [sub.id]: e.target.value }))
                  }
                  placeholder="Review note (optional)"
                  style={{ ...input(), fontSize: 13, flex: 1, minWidth: 160 }}
                />
                <button
                  onClick={() => handleReview(sub.id, "approve")}
                  disabled={processing.has(sub.id)}
                  className="btn-pill"
                  style={{
                    fontSize: 13,
                    padding: "0.55rem 1.15rem",
                    background: "hsl(var(--ink))",
                    color: "hsl(var(--cream))",
                    border: "1px solid transparent",
                    boxShadow: "var(--shadow-soft)",
                    opacity: processing.has(sub.id) ? 0.6 : 1,
                    cursor: processing.has(sub.id) ? "not-allowed" : "pointer",
                  }}
                >
                  Approve
                </button>
                <button
                  onClick={() => handleReview(sub.id, "reject")}
                  disabled={processing.has(sub.id)}
                  className="btn-pill"
                  style={{
                    fontSize: 13,
                    padding: "0.55rem 1.15rem",
                    background: "transparent",
                    color: "hsl(var(--foreground))",
                    border: "1px solid hsl(var(--rule-warm) / 0.7)",
                    opacity: processing.has(sub.id) ? 0.6 : 1,
                    cursor: processing.has(sub.id) ? "not-allowed" : "pointer",
                  }}
                >
                  Reject
                </button>
              </div>
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}
