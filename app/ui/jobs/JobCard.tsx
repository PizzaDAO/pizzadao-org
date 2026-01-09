"use client";

import React, { useState } from "react";

type Job = {
  id: number;
  description: string;
  type: string | null;
  assignees: string[];
};

type JobCardProps = {
  job: Job;
  onAssign?: () => void;
  disabled?: boolean;
};

function card(): React.CSSProperties {
  return {
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: 14,
    padding: 16,
    boxShadow: "0 8px 30px rgba(0,0,0,0.06)",
    background: "white",
  };
}

function btn(disabled?: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "none",
    fontWeight: 650,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    background: "black",
    color: "white",
    fontSize: 13,
  };
}

export function JobCard({ job, onAssign, disabled }: JobCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

      onAssign?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign job");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={card()}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          padding: "4px 8px",
          background: "rgba(37,99,235,0.1)",
          color: "#2563eb",
          borderRadius: 6,
        }}>
          {job.type || "General"}
        </span>
        <span style={{ fontSize: 11, opacity: 0.4 }}>#{job.id}</span>
      </div>

      <p style={{ fontSize: 14, marginBottom: 12, marginTop: 8 }}>{job.description}</p>

      {job.assignees.length > 0 && (
        <p style={{ fontSize: 11, opacity: 0.5, marginBottom: 12 }}>
          Assigned to {job.assignees.length} user(s)
        </p>
      )}

      {error && (
        <div style={{ marginBottom: 12, padding: 8, background: "rgba(255,0,0,0.05)", borderRadius: 6, color: "#c00", fontSize: 12 }}>
          {error}
        </div>
      )}

      <button
        onClick={handleAssign}
        disabled={loading || disabled}
        style={btn(loading || disabled)}
      >
        {loading ? "Assigning..." : disabled ? "Finish current job first" : "Take this job"}
      </button>
    </div>
  );
}
