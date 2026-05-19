"use client";

import React, { useState } from "react";
import { btn, badge } from "../shared-styles";

type ActiveJobProps = {
  job: {
    id: number;
    description: string;
    type: string | null;
  };
  onQuit?: () => void;
};

export function ActiveJob({ job, onQuit }: ActiveJobProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleQuit = async () => {
    if (
      !confirm(
        "Are you sure you want to quit this job? You won't receive any reward.",
      )
    ) {
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
    <div
      style={{
        padding: 24,
        background: "hsl(var(--cream-warm))",
        border: "1px solid hsl(var(--tomato) / 0.30)",
        borderRadius: "var(--radius)",
        boxShadow: "0 8px 30px hsl(var(--ink) / 0.06)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Subtle tomato accent rule on top */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 4,
          background: "hsl(var(--tomato))",
        }}
      />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 12,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <h2
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: "hsl(var(--foreground))",
            margin: 0,
            fontFamily:
              "var(--font-display), var(--font-sans), system-ui, sans-serif",
            letterSpacing: "-0.01em",
          }}
        >
          Your Active Job
        </h2>
        <span style={badge("accent")}>{job.type || "General"}</span>
      </div>

      <p
        style={{
          fontSize: 16,
          marginBottom: 20,
          marginTop: 0,
          lineHeight: 1.5,
          color: "hsl(var(--foreground))",
        }}
      >
        {job.description}
      </p>

      {/* Progress rail — tomato fill on rule track */}
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 12,
            color: "hsl(var(--muted-foreground))",
            marginBottom: 6,
          }}
        >
          <span>In progress</span>
          <span>Awaiting proof</span>
        </div>
        <div
          style={{
            height: 6,
            background: "hsl(var(--rule) / 0.12)",
            borderRadius: 999,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: "60%",
              height: "100%",
              background: "hsl(var(--tomato))",
              borderRadius: 999,
            }}
          />
        </div>
      </div>

      {error && (
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            background: "hsl(var(--tomato) / 0.06)",
            border: "1px solid hsl(var(--tomato) / 0.30)",
            borderRadius: "var(--radius)",
            color: "hsl(var(--tomato))",
            fontSize: 14,
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <button
          onClick={handleQuit}
          disabled={loading}
          style={{
            ...btn("secondary", loading),
            borderColor: "hsl(var(--tomato) / 0.40)",
            color: "hsl(var(--tomato))",
          }}
        >
          {loading ? "Quitting..." : "Quit Job"}
        </button>
        <p
          style={{
            fontSize: 13,
            color: "hsl(var(--muted-foreground))",
            margin: 0,
            flex: 1,
            minWidth: 200,
          }}
        >
          Complete this job and submit proof to an admin to receive your
          reward!
        </p>
      </div>
    </div>
  );
}
