"use client";

// garlic-68749 (Restyle Phase 4b): admin review panel restyled — cream-warm
// surface with butter ring (pending = butter), submission rows are subdued
// card surfaces, approve = `btn("primary")` ink, reject = `btn("secondary")`,
// ban-hammer would use the destructive (`bg-destructive`) treatment (not
// currently rendered — no ban action wired up here yet, but tokens are ready
// if/when the API exposes one).

import { useState, useEffect } from "react";
import { btn, input } from "../shared-styles";

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

  // Don't render anything if not admin
  if (error === "admin-only") return null;
  if (loading) return null;
  if (submissions.length === 0) return null;

  return (
    <div
      style={{
        border: "1px solid hsl(var(--butter))",
        borderRadius: "var(--radius)",
        padding: 22,
        boxShadow: "0 8px 30px hsl(var(--ink) / 0.06)",
        background: "hsl(var(--cream-warm))",
        color: "hsl(var(--card-foreground))",
        display: "grid",
        gap: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "4px 12px",
            borderRadius: 999,
            background: "hsl(var(--butter))",
            color: "hsl(var(--ink))",
            fontFamily: DISPLAY_FONT,
            fontWeight: 800,
            fontSize: 13,
            letterSpacing: 0.5,
            textTransform: "uppercase",
          }}
        >
          Admin
        </span>
        <h3
          style={{
            margin: 0,
            fontSize: 20,
            fontFamily: DISPLAY_FONT,
            fontWeight: 700,
            color: "hsl(var(--foreground))",
          }}
        >
          Pending Reviews ({submissions.length})
        </h3>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {submissions.map((sub) => (
          <div
            key={sub.id}
            style={{
              padding: 14,
              borderRadius: "var(--radius)",
              border: "1px solid hsl(var(--rule) / 0.12)",
              background: "hsl(var(--card))",
              display: "grid",
              gap: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: DISPLAY_FONT,
                    fontWeight: 700,
                    fontSize: 16,
                    color: "hsl(var(--foreground))",
                  }}
                >
                  <span style={{ color: "hsl(var(--tomato))", marginRight: 6 }}>
                    Lv.{sub.mission.level}
                  </span>
                  {sub.mission.title}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "hsl(var(--muted-foreground))",
                    marginTop: 2,
                  }}
                >
                  by {sub.memberName ?? sub.discordId} &middot;{" "}
                  {new Date(sub.submittedAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </div>
              </div>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  padding: "3px 10px",
                  borderRadius: 999,
                  background: "hsl(var(--butter) / 0.25)",
                  color: "hsl(var(--ink))",
                  border: "1px solid hsl(var(--butter))",
                  fontFamily: DISPLAY_FONT,
                  fontWeight: 700,
                  fontSize: 11,
                  letterSpacing: 0.4,
                  textTransform: "uppercase",
                }}
              >
                Pending
              </span>
            </div>

            {sub.evidence && (
              <div style={{ fontSize: 13, color: "hsl(var(--foreground))" }}>
                <strong style={{ fontFamily: DISPLAY_FONT }}>Evidence:</strong>{" "}
                {sub.evidence.startsWith("http") ? (
                  <a
                    href={sub.evidence}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      color: "hsl(var(--tomato))",
                      textDecoration: "underline",
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
              <div style={{ fontSize: 13, color: "hsl(var(--foreground))" }}>
                <strong style={{ fontFamily: DISPLAY_FONT }}>Notes:</strong>{" "}
                {sub.notes}
              </div>
            )}

            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
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
                style={{
                  ...btn("primary", processing.has(sub.id)),
                  fontSize: 13,
                  padding: "8px 16px",
                }}
              >
                Approve
              </button>
              <button
                onClick={() => handleReview(sub.id, "reject")}
                disabled={processing.has(sub.id)}
                style={{
                  ...btn("secondary", processing.has(sub.id)),
                  fontSize: 13,
                  padding: "8px 16px",
                }}
              >
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
