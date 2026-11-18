"use client";

import React, { useState, useEffect } from "react";
import { JobCard } from "./JobCard";
import { card, btn } from "../shared-styles";
import { useSession } from "@/app/lib/hooks/use-session";
import type { ResolvedUser } from '@/app/lib/discord-markup'

type Job = {
  id: number;
  description: string;
  type: string | null;
  completed: boolean;
};

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
  // Reset is admin-only server-side; only show the button to admins.
  const { data: session } = useSession();
  const isAdmin = session?.isAdmin === true;
  const [jobs, setJobs] = useState<Job[]>([]);
  const [resetAt, setResetAt] = useState<Date | null>(null);
  const [countdown, setCountdown] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rewardAmount, setRewardAmount] = useState<number>(50);
  const [channels, setChannels] = useState<Record<string, string>>({});
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [users, setUsers] = useState<Record<string, ResolvedUser>>({});
  const [guildId, setGuildId] = useState<string | null>(null);

  // Resolves to the server's resetAt (ms) on success, or null on failure.
  const fetchJobs = async (): Promise<number | null> => {
    let nextResetMs: number | null = null;
    try {
      const res = await fetch("/api/jobs", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch jobs");
      setJobs(data.jobs);
      if (data.resetAt) {
        const next = new Date(data.resetAt);
        nextResetMs = next.getTime();
        // Only update when the timestamp actually changed, so an unchanged
        // response doesn't re-run the countdown effect.
        setResetAt((prev) =>
          prev && prev.getTime() === next.getTime() ? prev : next,
        );
      }
      if (data.rewardAmount) {
        setRewardAmount(data.rewardAmount);
      }
      setChannels(data.channels || {});
      setRoles(data.roles || {});
      setUsers(data.users || {});
      setGuildId(data.guildId ?? null);
      setError(null);
      return nextResetMs ?? Date.now();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  // Countdown timer. Ticks once a second until the reset time passes, then
  // stops and refreshes jobs, retrying with exponential backoff while the
  // server keeps returning a stale/past reset time or errors.
  useEffect(() => {
    if (!resetAt) return;

    let interval: ReturnType<typeof setInterval> | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    let attempt = 0;

    const refreshAfterReset = async () => {
      const nextResetMs = await fetchJobs();
      if (cancelled) return;
      // Success with a new future reset time: setResetAt re-runs this effect.
      if (nextResetMs !== null && nextResetMs > Date.now()) return;
      const delay = Math.min(5_000 * 2 ** attempt, 5 * 60_000);
      attempt += 1;
      retry = setTimeout(refreshAfterReset, delay);
    };

    const updateCountdown = () => {
      const diff = resetAt.getTime() - Date.now();

      if (diff <= 0) {
        if (interval) clearInterval(interval);
        interval = null;
        setCountdown("Refreshing...");
        void refreshAfterReset();
        return;
      }

      setCountdown(formatCountdown(diff));
    };

    updateCountdown();
    if (resetAt.getTime() - Date.now() > 0) {
      interval = setInterval(updateCountdown, 1000);
    }

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      if (retry) clearTimeout(retry);
    };
  }, [resetAt]);

  if (loading) {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "grid", gap: 12 }}>
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              style={{
                height: 120,
                background: "hsl(var(--muted))",
                borderRadius: "var(--radius)",
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          ...card(),
          background: "hsl(var(--tomato) / 0.06)",
          borderColor: "hsl(var(--tomato) / 0.30)",
        }}
      >
        <p style={{ color: "hsl(var(--tomato))", margin: 0 }}>{error}</p>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <h2
            style={{
              fontSize: 22,
              fontWeight: 700,
              margin: 0,
              fontFamily:
                "var(--font-display), var(--font-sans), system-ui, sans-serif",
              letterSpacing: "-0.01em",
              color: "hsl(var(--foreground))",
            }}
          >
            Today&apos;s Jobs
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 12px",
                background: "hsl(var(--muted))",
                border: "1px solid hsl(var(--rule) / 0.12)",
                borderRadius: "var(--radius)",
                fontSize: 13,
              }}
            >
              <span style={{ color: "hsl(var(--muted-foreground))" }}>
                New jobs in:
              </span>
              <span
                style={{
                  fontWeight: 700,
                  fontFamily: "var(--font-mono), monospace",
                  color: "hsl(var(--tomato))",
                }}
              >
                {countdown}
              </span>
            </div>
            {isAdmin && (
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
                ...btn("secondary"),
                padding: "6px 10px",
                fontSize: 12,
              }}
              title="Reset today's jobs"
            >
              ↻
            </button>
            )}
          </div>
        </div>

        {jobs.length === 0 ? (
          <div style={{ ...card(), textAlign: "center" }}>
            <p style={{ color: "hsl(var(--muted-foreground))", margin: 0 }}>
              No jobs available at the moment
            </p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                rewardAmount={rewardAmount}
                alreadyCompleted={job.completed}
                channels={channels}
                roles={roles}
                users={users}
                guildId={guildId}
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
