"use client";

// capricciosa-10448 — Editorial restyle of /missions.
//
// Mission cards adopt the dossier vocabulary from the editorial system
// (NameStep/WelcomeStep precedent): paper-soft surface with hand-stamped
// file-number aesthetic, each card slightly rotated for the dossier-on-a-desk
// feel, handwritten "approved" / "pending" / "complete" margin stamps on
// completed/pending missions, btn-pill CTAs in tomato (Submit) or ink
// (Complete). No state/API/i18n changes — pure visual layer.
//
// Prior history: garlic-68749 (Phase 4b token migration).

import { useState } from "react";
import { input } from "../shared-styles";

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
    display: "inline-flex" as const,
    alignItems: "center" as const,
    gap: 6,
    padding: "3px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    fontFamily: DISPLAY_FONT,
    letterSpacing: "0.18em",
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

  // capricciosa-10448: file-number badge — like a case-file id on a folder tab.
  const fileNumber = `M-${String(mission.index).padStart(2, "0")}`;

  // Deterministic rotation per mission so the dossier-on-a-desk feel doesn't
  // jitter on every render. index parity decides the tilt direction.
  const tilt = isLocked
    ? 0
    : ((mission.id % 2 === 0 ? -1 : 1) * (0.4 + (mission.id % 3) * 0.15)).toFixed(2);

  return (
    <div
      className={isLocked ? "" : "paper-soft"}
      style={{
        position: "relative",
        padding: "18px 18px 16px",
        borderRadius: "var(--radius)",
        border: isCompleted
          ? "1px solid rgba(16, 185, 129, 0.32)"
          : isRejected
            ? "1px solid hsl(var(--tomato) / 0.30)"
            : "1px solid hsl(var(--rule-warm) / 0.55)",
        background: isCompleted
          ? "rgba(16, 185, 129, 0.06)"
          : "hsl(var(--cream))",
        color: "hsl(var(--card-foreground))",
        opacity: isLocked ? 0.55 : 1,
        boxShadow: isLocked ? "none" : "var(--shadow-soft)",
        transform: `rotate(${tilt}deg)`,
        transition:
          "transform 220ms var(--ease-editorial), box-shadow 220ms var(--ease-editorial)",
      }}
    >
      {/* Approved / Pending margin stamp — handwritten editorial mark */}
      {(isCompleted || isPending || isRejected) && (
        <span
          aria-hidden
          className="handwritten"
          style={{
            position: "absolute",
            top: 8,
            right: 12,
            fontSize: 14,
            transform: "rotate(-8deg)",
            color: isCompleted
              ? "rgb(4, 120, 87)"
              : isRejected
                ? "hsl(var(--tomato-deep))"
                : "hsl(var(--ink) / 0.6)",
            opacity: 0.7,
            pointerEvents: "none",
            whiteSpace: "nowrap",
          }}
        >
          {isCompleted ? "approved" : isPending ? "pending" : "needs work"}
        </span>
      )}

      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* File-number overline + status pill */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              marginBottom: 6,
            }}
          >
            <span
              className="overline"
              style={{
                color: "hsl(var(--muted-foreground))",
                fontFeatureSettings: "'tnum' 1",
              }}
            >
              § FILE {fileNumber}
            </span>
            <span style={statusPillStyle(pillVariant)}>
              {pillIcon && <span aria-hidden>{pillIcon}</span>}
              {pillLabel}
            </span>
          </div>

          <div
            style={{
              fontFamily: DISPLAY_FONT,
              fontWeight: 700,
              fontSize: "clamp(1.05rem, 2.2vw, 1.2rem)",
              lineHeight: 1.2,
              letterSpacing: "-0.01em",
              color: "hsl(var(--foreground))",
            }}
          >
            {mission.title}
          </div>

          {mission.description && (
            <div
              style={{
                fontSize: 14,
                color: "hsl(var(--muted-foreground))",
                marginTop: 8,
                lineHeight: 1.55,
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
                marginTop: 8,
                fontStyle: "italic",
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span aria-hidden style={{ opacity: 0.7 }}>↻</span>
              Auto-verified on submit
            </div>
          )}
          {isRejected && mission.progress?.reviewNote && (
            <div
              style={{
                fontSize: 13,
                color: "hsl(var(--tomato-deep))",
                marginTop: 8,
                fontWeight: 500,
                padding: "8px 10px",
                background: "hsl(var(--tomato) / 0.05)",
                borderLeft: "2px solid hsl(var(--tomato))",
                borderRadius: 4,
              }}
            >
              <span
                className="overline"
                style={{ display: "block", marginBottom: 2, color: "hsl(var(--tomato-deep))" }}
              >
                § Reviewer note
              </span>
              {mission.progress.reviewNote}
            </div>
          )}
        </div>
        {canSubmit && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="btn-pill"
            style={{
              fontSize: 13,
              padding: "0.55rem 1.15rem",
              background: expanded
                ? "transparent"
                : mission.autoVerify
                  ? "hsl(var(--tomato))"
                  : "hsl(var(--ink))",
              color: expanded
                ? "hsl(var(--foreground))"
                : "hsl(var(--cream))",
              border: expanded
                ? "1px solid hsl(var(--rule-warm) / 0.55)"
                : "1px solid transparent",
              boxShadow: expanded ? "none" : "var(--shadow-soft)",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {expanded ? "Cancel" : mission.autoVerify ? "Complete" : "Submit"}
          </button>
        )}
      </div>

      {expanded && canSubmit && (
        <div
          style={{
            marginTop: 16,
            paddingTop: 16,
            borderTop: "1px dashed hsl(var(--rule-warm) / 0.55)",
            display: "grid",
            gap: 12,
          }}
        >
          <div>
            <label
              className="overline"
              style={{
                display: "block",
                marginBottom: 6,
                color: "hsl(var(--foreground))",
              }}
            >
              § Evidence (optional)
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
              className="overline"
              style={{
                display: "block",
                marginBottom: 6,
                color: "hsl(var(--foreground))",
              }}
            >
              § Notes (optional)
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
            className="btn-pill"
            style={{
              fontSize: 13,
              justifySelf: "start",
              background: "hsl(var(--tomato))",
              color: "hsl(var(--cream))",
              border: "1px solid transparent",
              boxShadow: "var(--shadow-soft)",
              opacity: submitting ? 0.6 : 1,
              cursor: submitting ? "not-allowed" : "pointer",
            }}
          >
            {submitting ? "Submitting..." : "Submit for review"}
          </button>
        </div>
      )}
    </div>
  );
}
