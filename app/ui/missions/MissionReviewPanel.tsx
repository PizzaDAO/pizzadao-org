"use client";

import { useState, useEffect } from "react";
import { card, btn, input } from "../shared-styles";

type Submission = {
  id: number;
  missionId: number;
  discordId: string;
  memberId: string | null;
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
    <div style={{ ...card(), borderColor: "#eab30833" }}>
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
        Pending Reviews ({submissions.length})
      </h3>

      <div style={{ display: "grid", gap: 12 }}>
        {submissions.map((sub) => (
          <div
            key={sub.id}
            style={{
              padding: 12,
              borderRadius: 10,
              border: "1px solid var(--color-border)",
              background: "var(--color-surface)",
              display: "grid",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  Level {sub.mission.level}: {sub.mission.title}
                </div>
                <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>
                  by {sub.memberId ? `#${sub.memberId}` : sub.discordId} &middot;{" "}
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
              <div style={{ fontSize: 13 }}>
                <strong>Evidence:</strong>{" "}
                {sub.evidence.startsWith("http") ? (
                  <a
                    href={sub.evidence}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "var(--color-text-primary)", textDecoration: "underline" }}
                  >
                    {sub.evidence}
                  </a>
                ) : (
                  sub.evidence
                )}
              </div>
            )}

            {sub.notes && (
              <div style={{ fontSize: 13 }}>
                <strong>Notes:</strong> {sub.notes}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="text"
                value={reviewNotes[sub.id] || ""}
                onChange={(e) =>
                  setReviewNotes((prev) => ({ ...prev, [sub.id]: e.target.value }))
                }
                placeholder="Review note (optional)"
                style={{ ...input(), fontSize: 12, flex: 1, minWidth: 150 }}
              />
              <button
                onClick={() => handleReview(sub.id, "approve")}
                disabled={processing.has(sub.id)}
                style={{
                  ...btn("primary", processing.has(sub.id)),
                  fontSize: 12,
                  padding: "6px 14px",
                  background: "#16a34a",
                  borderColor: "#16a34a",
                  color: "#fff",
                }}
              >
                Approve
              </button>
              <button
                onClick={() => handleReview(sub.id, "reject")}
                disabled={processing.has(sub.id)}
                style={{
                  ...btn("secondary", processing.has(sub.id)),
                  fontSize: 12,
                  padding: "6px 14px",
                  color: "#ef4444",
                  borderColor: "#ef4444",
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
