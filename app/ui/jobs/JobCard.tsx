"use client";

import React, { useState } from "react";
import { PepAmount } from "../economy/PepIcon";
import { card as cardBase, btn, badge } from "../shared-styles";

type Job = {
  id: number;
  description: string;
  type: string | null;
  assignees: string[];
};

type JobCardProps = {
  job: Job;
  rewardAmount: number;
  alreadyCompleted?: boolean;
  onAssign?: () => void;
  disabled?: boolean;
};

function cardStyle(completed?: boolean): React.CSSProperties {
  if (completed) {
    return {
      ...cardBase(),
      padding: 16,
      gap: 0,
      borderColor: "hsl(142 71% 35% / 0.35)",
      background: "hsl(142 71% 35% / 0.06)",
    };
  }
  return {
    ...cardBase(),
    padding: 16,
    gap: 0,
  };
}

export function JobCard({
  job,
  rewardAmount,
  alreadyCompleted,
  onAssign,
  disabled,
}: JobCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justCompleted, setJustCompleted] = useState(false);
  const [earnedReward, setEarnedReward] = useState<number | null>(null);

  const completed = alreadyCompleted || justCompleted;

  const handleAssign = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/jobs/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setJustCompleted(true);
      setEarnedReward(data.reward);

      // Refresh after a short delay to update balance display
      setTimeout(() => {
        onAssign?.();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete job");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ ...cardStyle(completed), display: "flex", alignItems: "center", gap: 12 }}>
      {/* Left side - content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
          <span style={badge("default")}>{job.type || "General"}</span>
          {completed && (
            <span
              style={{
                ...badge("default"),
                background: "hsl(142 71% 35% / 0.12)",
                color: "hsl(142 71% 30%)",
                borderColor: "hsl(142 71% 35% / 0.35)",
              }}
            >
              Done
            </span>
          )}
          <span style={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}>#{job.id}</span>
        </div>
        <p
          style={{
            fontSize: 14,
            margin: 0,
            lineHeight: 1.45,
            color: "hsl(var(--foreground))",
          }}
        >
          {job.description}
        </p>
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

      {/* Right side - button */}
      <div style={{ flexShrink: 0 }}>
        {completed ? (
          <div
            style={{
              padding: "8px 12px",
              background: "hsl(142 71% 35% / 0.12)",
              border: "1px solid hsl(142 71% 35% / 0.30)",
              borderRadius: "var(--radius)",
              color: "hsl(142 71% 28%)",
              fontWeight: 700,
              fontSize: 14,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            {earnedReward ? "+" : ""}
            <PepAmount amount={earnedReward || rewardAmount} size={14} />
          </div>
        ) : (
          <button
            onClick={handleAssign}
            disabled={loading || disabled}
            style={{
              ...btn("accent", loading || disabled),
              padding: "8px 14px",
              fontSize: 14,
            }}
          >
            {loading ? "..." : <PepAmount amount={rewardAmount} size={14} />}
          </button>
        )}
      </div>
    </div>
  );
}
