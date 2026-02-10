"use client";

import React, { useState, useEffect } from "react";
import { JobCard } from "./JobCard";

type Job = {
  id: number;
  description: string;
  type: string | null;
  assignees: string[];
  completed: boolean;
};

function card(): React.CSSProperties {
  return {
    border: '1px solid var(--color-border)',
    borderRadius: 14,
    padding: 20,
    boxShadow: 'var(--shadow-card)',
    background: 'var(--color-surface)',
  };
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "Refreshing...";

  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((ms % (1000 * 60)) / 1000);

  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || hours > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return parts.join(" ");
}

type JobBoardProps = {
  onJobCompleted?: () => void;
};

export function JobBoard({ onJobCompleted }: JobBoardProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [resetAt, setResetAt] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rewardAmount, setRewardAmount] = useState<number>(50);

  const fetchJobs = async () => {
    try {
      const res = await fetch("/api/jobs");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch jobs");
      setJobs(data.jobs);
      if (data.resetAt) {
        setResetAt(new Date(data.resetAt));
      }
      if (data.rewardAmount) {
        setRewardAmount(data.rewardAmount);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  // Countdown timer
  useEffect(() => {
    if (!resetAt) return;

    const updateCountdown = () => {
      const now = new Date();
      const diff = resetAt.getTime() - now.getTime();

      if (diff <= 0) {
        // Reset has passed, refresh jobs
        setCountdown("Refreshing...");
        fetchJobs();
        return;
      }

      setCountdown(formatCountdown(diff));
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, [resetAt]);

  if (loading) {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "grid", gap: 12 }}>
          {[...Array(3)].map((_, i) => (
            <div key={i} style={{ height: 120, background: 'var(--color-surface-hover)', borderRadius: 14 }} />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ ...card(), background: "rgba(255,0,0,0.05)", borderColor: "rgba(255,0,0,0.3)" }}>
        <p style={{ color: "#c00" }}>{error}</p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Today's Jobs</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 12px",
              background: 'var(--color-page-bg)',
              borderRadius: 8,
              fontSize: 13
            }}>
              <span style={{ color: 'var(--color-text-secondary)' }}>New jobs in:</span>
              <span style={{ fontWeight: 700, fontFamily: "monospace", color: "#2563eb" }}>
                {countdown}
              </span>
            </div>
            <button
              onClick={async () => {
                if (!confirm("Reset all job completions for today?")) return;
                try {
                  const res = await fetch("/api/jobs/reset", { method: "POST" });
                  if (res.ok) {
                    fetchJobs();
                    onJobCompleted?.();
                  }
                } catch {}
              }}
              style={{
                padding: "6px 10px",
                borderRadius: 6,
                border: "none",
                background: "var(--color-surface-hover)",
                cursor: "pointer",
                fontSize: 12,
                color: 'var(--color-text-secondary)',
              }}
              title="Reset today's jobs"
            >
              ↻
            </button>
          </div>
        </div>

        {jobs.length === 0 ? (
          <div style={{ ...card(), textAlign: "center" }}>
            <p style={{ color: 'var(--color-text-secondary)' }}>No jobs available at the moment</p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                rewardAmount={rewardAmount}
                alreadyCompleted={job.completed}
                onAssign={() => {
                  fetchJobs();
                  onJobCompleted?.();
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
