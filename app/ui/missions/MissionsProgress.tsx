"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { card, btn } from "../shared-styles";

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

export function MissionsProgress() {
  const [data, setData] = useState<{
    levels: LevelData[];
    currentLevel: number;
    levelTitle: string | null;
    isAuthenticated: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/missions");
        if (res.ok) {
          const json = await res.json();
          setData(json);
        }
      } catch {
        // Silently fail - card just won't show
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Missions</h3>
        <Link
          href="/missions"
          style={{
            fontSize: 13,
            color: "var(--color-text-secondary)",
            textDecoration: "none",
          }}
        >
          View All &rarr;
        </Link>
      </div>

      {/* Current Level */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 24, fontWeight: 800 }}>
          {allDone ? "MAX" : `Lv.${currentLevel}`}
        </span>
        {levelTitle && (
          <span style={{ fontSize: 14, opacity: 0.6 }}>{levelTitle}</span>
        )}
        {allDone && (
          <span style={{ fontSize: 14, opacity: 0.6 }}>All levels complete!</span>
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
                opacity: 0.6,
                marginBottom: 4,
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
                borderRadius: 4,
                background: "var(--color-border)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${progressPercent}%`,
                  height: "100%",
                  borderRadius: 4,
                  background: "#16a34a",
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
                    opacity: done ? 0.6 : 1,
                  }}
                >
                  <span style={{ flexShrink: 0 }}>
                    {done ? "\u2705" : pending ? "\u23F3" : "\u25CB"}
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
          opacity: 0.5,
          borderTop: "1px solid var(--color-border)",
          paddingTop: 8,
        }}
      >
        Overall: {totalCompleted}/{totalMissions} missions completed
      </div>
    </div>
  );
}
