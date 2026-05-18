"use client";

// garlic-68749 (Restyle Phase 4b): MissionCard adopts the pizzadao.org tokens
// — card surface, Asap Condensed title, body Asap copy, status pills in
// butter (pending) / emerald (approved) / tomato (rejected), locked state
// is opacity-60 with a muted lock icon. Submit CTA = `btn("accent")` so the
// loud tomato action draws the eye.

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

const DISPLAY_FONT =
  "var(--font-display), var(--font-sans), system-ui, sans-serif";

type StatusVariant = "approved" | "pending" | "rejected" | "locked" | "open";

function statusPillStyle(variant: StatusVariant) {
  const base = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    fontFamily: DISPLAY_FONT,
    letterSpacing: 0.3,
    textTransform: "uppercase" as const,
    border: "1px solid transparent",
  };
  if (variant === "approved") {
    return {
      ...base,
      background: "rgba(16, 185, 129, 0.12)",
      color: "rgb(4, 120, 87)",
      borderColor: "rgba(16, 185, 129, 0.30)",
    };
  }
  if (variant === "pending") {
    return {
      ...base,
      background: "hsl(var(--butter) / 0.25)",
      color: "hsl(var(--ink))",
      borderColor: "hsl(var(--butter))",
    };
  }
  if (variant === "rejected") {
    return {
      ...base,
      background: "hsl(var(--tomato) / 0.10)",
      color: "hsl(var(--tomato-deep))",
      borderColor: "hsl(var(--tomato) / 0.30)",
    };
  }
  if (variant === "locked") {
    return {
      ...base,
      background: "hsl(var(--muted))",
      color: "hsl(var(--muted-foreground))",
      borderColor: "hsl(var(--rule) / 0.22)",
    };
  }
  // open
  return {
    ...base,
    background: "transparent",
    color: "hsl(var(--muted-foreground))",
    borderColor: "hsl(var(--rule) / 0.22)",
  };
}

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
  const isLocked = !levelUnlocked && !status;

  // Status pill: approved (emerald), pending (butter), rejected (tomato),
  // locked (muted with lock icon), or open (subtle outline).
  let pillVariant: StatusVariant = "open";
  let pillLabel = "Open";
  let pillIcon: string | null = null;
  if (isCompleted) {
    pillVariant = "approved";
    pillLabel = "Approved";
    pillIcon = "✓";
  } else if (isPending) {
    pillVariant = "pending";
    pillLabel = "Pending Review";
    pillIcon = "⏳";
  } else if (isRejected) {
    pillVariant = "rejected";
    pillLabel = "Rejected";
    pillIcon = "✕";
  } else if (isLocked) {
    pillVariant = "locked";
    pillLabel = "Locked";
    pillIcon = "🔒";
  }

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
        padding: "14px 16px",
        borderRadius: "var(--radius)",
        border: isCompleted
          ? "1px solid rgba(16, 185, 129, 0.30)"
          : "1px solid hsl(var(--rule) / 0.12)",
        background: isCompleted
          ? "rgba(16, 185, 129, 0.05)"
          : "hsl(var(--card))",
        color: "hsl(var(--card-foreground))",
        opacity: isLocked ? 0.6 : 1,
        transition: "background-color 150ms ease, border-color 150ms ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                fontFamily: DISPLAY_FONT,
                fontWeight: 700,
                fontSize: 17,
                lineHeight: 1.25,
                color: "hsl(var(--foreground))",
              }}
            >
              {mission.title}
            </div>
            <span style={statusPillStyle(pillVariant)}>
              {pillIcon && <span aria-hidden>{pillIcon}</span>}
              {pillLabel}
            </span>
          </div>
          {mission.description && (
            <div
              style={{
                fontSize: 14,
                color: "hsl(var(--muted-foreground))",
                marginTop: 6,
                lineHeight: 1.5,
              }}
            >
              {mission.description}
            </div>
          )}
          {mission.autoVerify && !status && (
            <div
              style={{
                fontSize: 12,
                color: "hsl(var(--muted-foreground))",
                marginTop: 6,
                fontStyle: "italic",
              }}
            >
              Auto-verified on submit
            </div>
          )}
          {isRejected && mission.progress?.reviewNote && (
            <div
              style={{
                fontSize: 13,
                color: "hsl(var(--tomato-deep))",
                marginTop: 6,
                fontWeight: 500,
              }}
            >
              Reviewer note: {mission.progress.reviewNote}
            </div>
          )}
        </div>
        {canSubmit && (
          <button
            onClick={() => setExpanded(!expanded)}
            style={{
              ...btn(mission.autoVerify ? "accent" : "primary"),
              fontSize: 13,
              padding: "8px 14px",
              whiteSpace: "nowrap",
            }}
          >
            {expanded ? "Cancel" : mission.autoVerify ? "Complete" : "Submit"}
          </button>
        )}
      </div>

      {expanded && canSubmit && (
        <div
          style={{
            marginTop: 14,
            paddingTop: 14,
            borderTop: "1px solid hsl(var(--rule) / 0.12)",
            display: "grid",
            gap: 10,
          }}
        >
          <div>
            <label
              style={{
                fontSize: 12,
                fontWeight: 700,
                fontFamily: DISPLAY_FONT,
                textTransform: "uppercase",
                letterSpacing: 0.5,
                display: "block",
                marginBottom: 4,
                color: "hsl(var(--foreground))",
              }}
            >
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
            <label
              style={{
                fontSize: 12,
                fontWeight: 700,
                fontFamily: DISPLAY_FONT,
                textTransform: "uppercase",
                letterSpacing: 0.5,
                display: "block",
                marginBottom: 4,
                color: "hsl(var(--foreground))",
              }}
            >
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
              ...btn("accent", submitting),
              fontSize: 13,
              justifySelf: "start",
            }}
          >
            {submitting ? "Submitting..." : "Submit for review"}
          </button>
        </div>
      )}
    </div>
  );
}
