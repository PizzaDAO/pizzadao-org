"use client";

import React, { useState } from "react";
import { PepIcon, PepAmount } from "../economy/PepIcon";

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

function card(completed?: boolean): React.CSSProperties {
  return {
    border: completed ? "1px solid rgba(22,163,74,0.3)" : "1px solid var(--color-border)",
    borderRadius: 14,
    padding: 16,
    boxShadow: 'var(--shadow-card)',
    background: completed ? "rgba(22,163,74,0.05)" : "var(--color-surface)",
  };
}

function btn(disabled?: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    borderRadius: 6,
    border: "none",
    fontWeight: 650,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    background: 'var(--color-btn-primary-bg)',
    color: 'var(--color-btn-primary-text)',
    fontSize: 12,
    whiteSpace: "nowrap" as const,
  };
}

export function JobCard({ job, rewardAmount, alreadyCompleted, onAssign, disabled }: JobCardProps) {
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
    <div style={{ ...card(completed), display: "flex", alignItems: "center", gap: 12 }}>
      {/* Left side - content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <span style={{
            fontSize: 10,
            fontWeight: 600,
            padding: "3px 6px",
            background: "rgba(37,99,235,0.1)",
            color: "#2563eb",
            borderRadius: 4,
          }}>
            {job.type || "General"}
          </span>
          {completed && (
            <span style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "3px 6px",
              background: "rgba(22,163,74,0.1)",
              color: "#16a34a",
              borderRadius: 4,
            }}>
              Done
            </span>
          )}
          <span style={{ fontSize: 10, color: "var(--color-text-muted)" }}>#{job.id}</span>
        </div>
        <p style={{ fontSize: 13, margin: 0, lineHeight: 1.4, color: 'var(--color-text-primary)' }}>{job.description}</p>
        {error && (
          <div style={{ marginTop: 8, padding: 6, background: "rgba(255,0,0,0.05)", borderRadius: 4, color: "#c00", fontSize: 11 }}>
            {error}
          </div>
        )}
      </div>

      {/* Right side - button */}
      <div style={{ flexShrink: 0 }}>
        {completed ? (
          <div style={{
            padding: "6px 10px",
            background: "rgba(22,163,74,0.1)",
            borderRadius: 6,
            color: "#16a34a",
            fontWeight: 700,
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            gap: 4
          }}>
            {earnedReward ? "+" : ""}<PepAmount amount={earnedReward || rewardAmount} size={12} />
          </div>
        ) : (
          <button
            onClick={handleAssign}
            disabled={loading || disabled}
            style={btn(loading || disabled)}
          >
            {loading ? "..." : <PepAmount amount={rewardAmount} size={12} />}
          </button>
        )}
      </div>
    </div>
  );
}
