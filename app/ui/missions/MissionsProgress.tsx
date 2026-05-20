"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { card } from "../shared-styles";

type LevelData = {
  level: number;
  title: string | null;
  reward: number;
  missions: {
    id: number;
    title: string;
    progress: { status: string } | null;
  }[];
};

export type MissionsSummary = {
  levels: LevelData[];
  currentLevel: number;
  levelTitle: string | null;
  isAuthenticated: boolean;
};

export type MissionsProgressProps = {
  /** Optional pre-fetched summary. When omitted, the component self-fetches
   * `/api/missions` (legacy behavior — used by `/missions` page). */
  summary?: MissionsSummary;
};

export function MissionsProgress({ summary }: MissionsProgressProps = {}) {
  const [fetched, setFetched] = useState<MissionsSummary | null>(null);
  const [loading, setLoading] = useState(summary === undefined);

  useEffect(() => {
    // If parent passed a summary, do not self-fetch.
    if (summary !== undefined) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/missions");
        if (res.ok) {
          const json = (await res.json()) as MissionsSummary;
          if (!cancelled) setFetched(json);
        }
      } catch {
        // Silently fail - card just won't show
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [summary]);

  const data = summary ?? fetched;

  if (loading || !data || !data.isAuthenticated) return null;

  const { currentLevel, levelTitle, levels } = data;
  const currentLevelData = levels.find((l) => l.level === currentLevel);

  // Calculate current level progress
  const currentMissions = currentLevelData?.missions || [];
  const completedCount = currentMissions.filter(
    (m) => m.progress?.status === "APPROVED"
  ).length;
  const totalCount = currentMissions.length;
  const progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  // Calculate overall progress
  const totalMissions = levels.reduce((sum, l) => sum + l.missions.length, 0);
  const totalCompleted = levels.reduce(
    (sum, l) =>
      sum + l.missions.filter((m) => m.progress?.status === "APPROVED").length,
    0
  );

  // Max level check
  const allDone = currentLevel > 8;

  return (
    <div style={{ ...card(), gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{
          margin: 0,
          fontSize: 18,
          fontWeight: 700,
          fontFamily: "var(--font-display), var(--font-sans), system-ui, sans-serif",
          letterSpacing: "-0.01em",
        }}>Missions</h3>
        <Link
          href="/missions"
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "hsl(var(--tomato))",
            textDecoration: "none",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
          onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
        >
          View All &rarr;
        </Link>
      </div>

      {/* Current Level */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{
          fontSize: 36,
          fontWeight: 800,
          lineHeight: 1,
          fontFamily: "var(--font-display), var(--font-sans), system-ui, sans-serif",
          color: "hsl(var(--tomato))",
        }}>
          {allDone ? "MAX" : `Lv.${currentLevel}`}
        </span>
        {levelTitle && (
          <span style={{
            fontSize: 14,
            fontWeight: 500,
            color: "hsl(var(--muted-foreground))",
          }}>{levelTitle}</span>
        )}
        {allDone && (
          <span style={{
            fontSize: 14,
            color: "hsl(var(--muted-foreground))",
          }}>All levels complete!</span>
        )}
      </div>

      {!allDone && currentLevelData && (
        <>
          {/* Progress Bar */}
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12,
                color: "hsl(var(--muted-foreground))",
                marginBottom: 6,
              }}
            >
              <span>
                {completedCount}/{totalCount} missions
              </span>
              <span>{currentLevelData.reward.toLocaleString()} $PEP reward</span>
            </div>
            <div
              style={{
                height: 8,
                borderRadius: 999,
                background: "hsl(var(--muted))",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${progressPercent}%`,
                  height: "100%",
                  borderRadius: 999,
                  background: "hsl(var(--tomato))",
                  transition: "width 0.3s ease",
                }}
              />
            </div>
          </div>

          {/* Mission Checklist */}
          <div style={{ display: "grid", gap: 4 }}>
            {currentMissions.map((m) => {
              const done = m.progress?.status === "APPROVED";
              const pending = m.progress?.status === "PENDING";
              return (
                <div
                  key={m.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 13,
                    color: done ? "hsl(var(--muted-foreground))" : "hsl(var(--foreground))",
                  }}
                >
                  <span style={{ flexShrink: 0 }}>
                    {done ? "✅" : pending ? "⏳" : "○"}
                  </span>
                  <span
                    style={{
                      textDecoration: done ? "line-through" : "none",
                    }}
                  >
                    {m.title}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Overall Progress */}
      <div
        style={{
          fontSize: 12,
          color: "hsl(var(--muted-foreground))",
          borderTop: "1px solid hsl(var(--rule) / 0.12)",
          paddingTop: 8,
        }}
      >
        Overall: {totalCompleted}/{totalMissions} missions completed
      </div>
    </div>
  );
}
