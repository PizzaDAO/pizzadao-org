"use client";

// The whole job card is one <button>: clicking (or Enter / Space on) any part
// of it completes the job. Disabled once done, while the request runs, or when
// the board disables it. The reward is a plain "50 $PEP".

import React, { useState } from "react";
import { formatPep } from "../economy/PepIcon";
import { paperCard } from "../shared/Editorial";

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

const chip =
  "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[12px] font-semibold";

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
  const inactive = completed || loading || !!disabled;
  const errorId = `job-${job.id}-error`;

  const handleAssign = async () => {
    if (inactive) return;
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

  const reward = earnedReward || rewardAmount;

  return (
    <div>
      <button
        type="button"
        onClick={handleAssign}
        disabled={inactive}
        aria-busy={loading || undefined}
        aria-describedby={error ? errorId : undefined}
        data-testid="job-card"
        className={[
          paperCard,
          "group flex w-full items-center gap-4 p-4 text-left font-[inherit] text-[inherit]",
          "shadow-[var(--shadow-soft)] transition-[transform,border-color,box-shadow] duration-200",
          "focus-visible:outline-none focus-visible:border-tomato focus-visible:ring-2 focus-visible:ring-tomato focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          completed
            ? "cursor-default border-[hsl(142_71%_35%/0.35)] bg-[hsl(142_71%_35%/0.06)]"
            : inactive
              ? "cursor-not-allowed opacity-60"
              : "cursor-pointer hover:-translate-y-0.5 hover:border-[hsl(var(--tomato)/0.55)] hover:shadow-[var(--shadow-lifted)] active:translate-y-0",
        ].join(" ")}
      >
        <span className="min-w-0 flex-1">
          <span className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className={`${chip} border-[hsl(var(--rule)/0.22)] bg-muted text-foreground`}>
              {job.type || "General"}
            </span>
            {completed && (
              <span className={`${chip} border-[hsl(142_71%_35%/0.35)] bg-[hsl(142_71%_35%/0.12)] text-[hsl(142_71%_30%)]`}>
                Done
              </span>
            )}
            <span className="text-[11px] text-muted-foreground">#{job.id}</span>
          </span>
          <span className="block text-sm leading-[1.45] text-foreground">{job.description}</span>
        </span>

        <span className="flex shrink-0 flex-col items-end gap-1 text-right">
          <span
            className={`font-[family-name:var(--font-display)] text-lg font-black tracking-tight tabular-nums whitespace-nowrap ${
              completed ? "text-[hsl(142_71%_30%)]" : "text-tomato"
            }`}
          >
            {completed && earnedReward ? "+" : ""}
            {formatPep(reward)}
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-foreground/55">
            {loading ? "Working…" : completed ? "Paid" : "Complete"}
            {!completed && !loading && (
              <span aria-hidden className="ml-1 inline-block transition-transform group-hover:translate-x-0.5">
                →
              </span>
            )}
          </span>
        </span>
      </button>

      {error && (
        <p
          id={errorId}
          role="alert"
          className="mt-2 mb-0 rounded-[var(--radius)] border border-[hsl(var(--tomato)/0.30)] bg-[hsl(var(--tomato)/0.06)] p-2 text-xs text-tomato"
        >
          {error}
        </p>
      )}
    </div>
  );
}
