"use client";

// capricciosa-10448 — Editorial restyle of the MissionsProgress card.
//
// Light dossier voice: § overline, display-font level number with optional
// circle-scribble level title, the progress bar gets a soft inset rule, and
// the mission checklist is presented like a marked-up to-do list with
// strikethrough for approved missions and a handwritten "ongoing" margin
// hint. Fetching/state logic untouched.

import { useEffect, useState } from "react";
import Link from "next/link";

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

const DISPLAY_FONT =
  "var(--font-display), var(--font-sans), system-ui, sans-serif";

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
    <div
      className="paper-soft"
      style={{
        position: "relative",
        border: "1px solid hsl(var(--rule-warm) / 0.55)",
        borderRadius: "var(--radius)",
        padding: 22,
        boxShadow: "var(--shadow-soft)",
        background: "hsl(var(--cream))",
        color: "hsl(var(--card-foreground))",
        display: "grid",
        gap: 14,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 10,
        }}
      >
        <div>
          <span
            className="overline"
            style={{
              display: "block",
              color: "hsl(var(--tomato))",
              marginBottom: 2,
            }}
          >
            § Dossier
          </span>
          <h3
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 800,
              letterSpacing: "-0.015em",
              lineHeight: 1.05,
              fontFamily: DISPLAY_FONT,
              color: "hsl(var(--foreground))",
            }}
          >
            Missions
          </h3>
        </div>
        <Link
          href="/missions"
          className="overline"
          style={{
            color: "hsl(var(--tomato))",
            textDecoration: "none",
            transition: "color 150ms ease",
            whiteSpace: "nowrap",
          }}
        >
          View All →
        </Link>
      </div>

      {/* Current Level — big editorial display */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: "clamp(2.25rem, 7vw, 3rem)",
            fontWeight: 900,
            lineHeight: 0.9,
            letterSpacing: "-0.02em",
            fontFamily: DISPLAY_FONT,
            color: "hsl(var(--tomato))",
          }}
        >
          {allDone ? "MAX" : (
            <>
              <span style={{ color: "hsl(var(--foreground) / 0.35)", fontWeight: 700 }}>
                Lv.
              </span>
              {currentLevel}
            </>
          )}
        </span>
        {levelTitle && (
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              fontFamily: DISPLAY_FONT,
              color: "hsl(var(--foreground))",
            }}
          >
            <span className="circle-scribble">{levelTitle}</span>
          </span>
        )}
        {allDone && (
          <span
            className="handwritten"
            style={{
              fontSize: 14,
              color: "hsl(var(--muted-foreground))",
              transform: "rotate(-2deg)",
              display: "inline-block",
            }}
          >
            All levels complete!
          </span>
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
                fontSize: 11,
                fontFamily: DISPLAY_FONT,
                textTransform: "uppercase",
                letterSpacing: "0.18em",
                fontWeight: 600,
                color: "hsl(var(--muted-foreground))",
                marginBottom: 8,
              }}
            >
              <span>
                {completedCount}/{totalCount} on file
              </span>
              <span style={{ color: "hsl(var(--tomato))" }}>
                +{currentLevelData.reward.toLocaleString()} $PEP
              </span>
            </div>
            <div
              style={{
                height: 8,
                borderRadius: 999,
                background: "hsl(var(--muted))",
                border: "1px solid hsl(var(--rule-warm) / 0.4)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${progressPercent}%`,
                  height: "100%",
                  borderRadius: 999,
                  background:
                    "linear-gradient(90deg, hsl(var(--tomato)) 0%, hsl(var(--tomato-deep)) 100%)",
                  transition: "width 0.45s var(--ease-editorial)",
                }}
              />
            </div>
          </div>

          {/* Mission Checklist — marked-up to-do feel */}
          <div style={{ display: "grid", gap: 6 }}>
            {currentMissions.map((m) => {
              const done = m.progress?.status === "APPROVED";
              const pending = m.progress?.status === "PENDING";
              return (
                <div
                  key={m.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    fontSize: 13,
                    color: done
                      ? "hsl(var(--muted-foreground))"
                      : "hsl(var(--foreground))",
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      width: 16,
                      height: 16,
                      borderRadius: 4,
                      border: "1.5px solid hsl(var(--rule-warm) / 0.7)",
                      background: done
                        ? "rgb(16, 185, 129)"
                        : pending
                          ? "hsl(var(--butter) / 0.4)"
                          : "transparent",
                      color: "hsl(var(--cream))",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 11,
                      fontWeight: 800,
                    }}
                    aria-hidden
                  >
                    {done ? "✓" : pending ? "⋯" : ""}
                  </span>
                  <span
                    style={{
                      textDecoration: done ? "line-through" : "none",
                      textDecorationColor: done
                        ? "hsl(var(--tomato) / 0.7)"
                        : undefined,
                      textDecorationThickness: done ? 2 : undefined,
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

      {/* Overall Progress footer rule */}
      <div
        style={{
          fontSize: 11,
          fontFamily: DISPLAY_FONT,
          textTransform: "uppercase",
          letterSpacing: "0.22em",
          fontWeight: 600,
          color: "hsl(var(--muted-foreground))",
          borderTop: "1px dashed hsl(var(--rule-warm) / 0.55)",
          paddingTop: 10,
        }}
      >
        § Overall · {totalCompleted}/{totalMissions} closed
      </div>
    </div>
  );
}
