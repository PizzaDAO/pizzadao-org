"use client";

import { useState } from "react";
import { btn, input } from "../shared-styles";

type MissionProgress = {
  status: string;
  submittedAt: string;
  reviewNote?: string | null;
};

type MissionData = {
  id: number;
  index: number;
  title: string;
  description: string | null;
  autoVerify: boolean;
  progress: MissionProgress | null;
};

type Props = {
  mission: MissionData;
  levelUnlocked: boolean;
  onSubmit: (missionId: number, evidence?: string, notes?: string) => Promise<void>;
};

export function MissionCard({ mission, levelUnlocked, onSubmit }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [evidence, setEvidence] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const status = mission.progress?.status;
  const isCompleted = status === "APPROVED";
  const isPending = status === "PENDING";
  const isRejected = status === "REJECTED";
  const canSubmit = !status && levelUnlocked;

  const statusIcon = isCompleted ? "\u2705" : isPending ? "\u23F3" : isRejected ? "\u274C" : "\u25CB";
  const statusLabel = isCompleted ? "Approved" : isPending ? "Pending Review" : isRejected ? "Rejected" : "";

  const statusColor = isCompleted
    ? "#16a34a"
    : isPending
      ? "#eab308"
      : isRejected
        ? "#ef4444"
        : "var(--color-text-secondary)";

  async function handleSubmit() {
    setSubmitting(true);
    try {
      await onSubmit(mission.id, evidence || undefined, notes || undefined);
      setExpanded(false);
      setEvidence("");
      setNotes("");
    } catch {
      // Error handled by parent
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      style={{
        padding: "12px 16px",
        borderRadius: 10,
        border: `1px solid ${isCompleted ? "#16a34a33" : "var(--color-border)"}`,
        background: isCompleted ? "var(--color-surface-hover)" : "var(--color-surface)",
        opacity: !levelUnlocked && !status ? 0.5 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <span style={{ fontSize: 18, lineHeight: "24px", flexShrink: 0 }}>{statusIcon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{mission.title}</div>
          {mission.description && (
            <div style={{ fontSize: 13, opacity: 0.6, marginTop: 4 }}>
              {mission.description}
            </div>
          )}
          {mission.autoVerify && !status && (
            <div style={{ fontSize: 11, opacity: 0.5, marginTop: 4, fontStyle: "italic" }}>
              Auto-verified on submit
            </div>
          )}
          {status && (
            <div style={{ fontSize: 12, color: statusColor, fontWeight: 600, marginTop: 4 }}>
              {statusLabel}
              {isRejected && mission.progress?.reviewNote && (
                <span style={{ fontWeight: 400, opacity: 0.8 }}>
                  {" "}
                  - {mission.progress.reviewNote}
                </span>
              )}
            </div>
          )}
        </div>
        {canSubmit && (
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              ...btn("primary"),
              fontSize: 12,
              padding: "6px 12px",
              whiteSpace: "nowrap",
            }}
          >
            {expanded ? "Cancel" : "Submit"}
          </button>
        )}
      </div>

      {expanded && canSubmit && (
        <div style={{ marginTop: 12, display: "grid", gap: 8, paddingLeft: 28 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>
              Evidence (optional)
            </label>
            <input
              type="text"
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              placeholder="Link to proof (screenshot, tweet, etc.)"
              style={{ ...input(), fontSize: 13 }}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>
              Notes (optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any additional context"
              style={{ ...input(), fontSize: 13 }}
            />
          </div>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              ...btn("primary", submitting),
              fontSize: 13,
              justifySelf: "start",
            }}
          >
            {submitting ? "Submitting..." : "Submit Mission"}
          </button>
        </div>
      )}
    </div>
  );
}
