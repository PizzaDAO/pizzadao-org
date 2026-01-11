"use client";

import React, { useState } from "react";

type ActiveJobProps = {
  job: {
    id: number;
    description: string;
    type: string | null;
  };
  onQuit?: () => void;
};

function btn(kind: "primary" | "danger", disabled?: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: "10px 16px",
    borderRadius: 8,
    border: "none",
    fontWeight: 650,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    fontSize: 14,
  };
  if (kind === "danger") return { ...base, background: "#dc2626", color: "white" };
  return { ...base, background: "black", color: "white" };
}

export function ActiveJob({ job, onQuit }: ActiveJobProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleQuit = async () => {
    if (!confirm("Are you sure you want to quit this job? You won't receive any reward.")) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/jobs/quit", {
        method: "POST",
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      onQuit?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to quit job");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      padding: 20,
      background: "linear-gradient(135deg, rgba(22,163,74,0.08) 0%, rgba(37,99,235,0.08) 100%)",
      border: "1px solid rgba(22,163,74,0.3)",
      borderRadius: 14,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "#16a34a", margin: 0 }}>Your Active Job</h2>
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          padding: "4px 8px",
          background: "rgba(22,163,74,0.15)",
          color: "#16a34a",
          borderRadius: 6,
        }}>
          {job.type || "General"}
        </span>
      </div>

      <p style={{ fontSize: 16, marginBottom: 16 }}>{job.description}</p>

      {error && (
        <div style={{ marginBottom: 16, padding: 12, background: "rgba(255,0,0,0.05)", borderRadius: 8, color: "#c00", fontSize: 14 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button
          onClick={handleQuit}
          disabled={loading}
          style={btn("danger", loading)}
        >
          {loading ? "Quitting..." : "Quit Job"}
        </button>
        <p style={{ fontSize: 13, opacity: 0.6, margin: 0 }}>
          Complete this job and submit proof to an admin to receive your reward!
        </p>
      </div>
    </div>
  );
}
