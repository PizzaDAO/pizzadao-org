"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Inter } from "next/font/google";
import { card, btn, pageContainer } from "../ui/shared-styles";
import { MissionCard } from "../ui/missions/MissionCard";
import { MissionReviewPanel } from "../ui/missions/MissionReviewPanel";

const inter = Inter({ subsets: ["latin"] });

type MissionData = {
  id: number;
  index: number;
  title: string;
  description: string | null;
  autoVerify: boolean;
  progress: { status: string; submittedAt: string; reviewNote?: string | null } | null;
};

type LevelData = {
  level: number;
  title: string | null;
  reward: number;
  missions: MissionData[];
};

type MissionsResponse = {
  levels: LevelData[];
  currentLevel: number;
  levelTitle: string | null;
  isAuthenticated: boolean;
};

const LEVEL_TITLES: Record<number, string> = {
  1: "Pizza Trainee",
  2: "Pizza Noob",
  6: "Street Muscle",
  7: "Made Mafia",
  8: "Don of Dons",
};

export default function MissionsPage() {
  const [data, setData] = useState<MissionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedLevels, setExpandedLevels] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetchMissions();
  }, []);

  async function fetchMissions() {
    try {
      const res = await fetch("/api/missions", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load missions");
      const json = await res.json();
      setData(json);

      // Auto-expand current level
      if (json.currentLevel) {
        setExpandedLevels(new Set([json.currentLevel]));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  function toggleLevel(level: number) {
    setExpandedLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) {
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  }

  async function handleSubmit(missionId: number, evidence?: string, notes?: string) {
    const res = await fetch("/api/missions/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ missionId, evidence, notes }),
    });

    if (!res.ok) {
      const json = await res.json();
      alert(json.error || "Submission failed");
      throw new Error(json.error);
    }

    const result = await res.json();
    const status = result.completion?.status || "PENDING";

    // Optimistically update the UI immediately
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        levels: prev.levels.map((level) => ({
          ...level,
          missions: level.missions.map((m) =>
            m.id === missionId
              ? { ...m, progress: { status, submittedAt: new Date().toISOString() } }
              : m
          ),
        })),
      };
    });

    // Then refresh from server for accurate level/reward data
    fetchMissions();
  }

  if (loading) {
    return (
      <div
        style={{
          ...pageContainer(inter.style.fontFamily),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              width: 50,
              height: 50,
              border: "4px solid var(--color-spinner-track)",
              borderTop: "4px solid var(--color-spinner-active)",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
              margin: "0 auto 20px",
            }}
          />
          <p style={{ fontSize: 18, opacity: 0.8 }}>Loading missions...</p>
          <style jsx>{`
            @keyframes spin {
              0% {
                transform: rotate(0deg);
              }
              100% {
                transform: rotate(360deg);
              }
            }
          `}</style>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={pageContainer(inter.style.fontFamily)}>
        <div style={{ maxWidth: 800, margin: "0 auto" }}>
          <div style={card()}>
            <h1 style={{ margin: 0, fontSize: 24 }}>Error</h1>
            <p style={{ opacity: 0.6 }}>{error || "Failed to load missions"}</p>
            <button onClick={() => window.location.reload()} style={btn("primary")}>
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const { levels, currentLevel, isAuthenticated } = data;

  return (
    <div style={pageContainer(inter.style.fontFamily)}>
      <div style={{ maxWidth: 800, margin: "0 auto", display: "grid", gap: 20 }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>Missions</h1>
            <p style={{ margin: "4px 0 0", opacity: 0.6, fontSize: 15 }}>
              Complete missions to level up and earn $PEP rewards
            </p>
          </div>
          <Link
            href="/"
            style={{
              ...btn("secondary"),
              fontSize: 14,
              textDecoration: "none",
            }}
          >
            &larr; Home
          </Link>
        </div>

        {/* Login prompt */}
        {!isAuthenticated && (
          <div style={{ ...card(), textAlign: "center" }}>
            <p style={{ margin: 0, fontSize: 15 }}>
              <a href="/api/auth/discord" style={{ color: "var(--color-text-primary)", fontWeight: 600 }}>
                Log in with Discord
              </a>{" "}
              to track your progress and submit missions.
            </p>
          </div>
        )}

        {/* Current Level Banner */}
        {isAuthenticated && (
          <div
            style={{
              ...card(),
              background: "linear-gradient(135deg, var(--color-surface) 0%, var(--color-surface-hover) 100%)",
              textAlign: "center",
              padding: 20,
            }}
          >
            <div style={{ fontSize: 14, opacity: 0.6, textTransform: "uppercase", letterSpacing: 1 }}>
              Current Level
            </div>
            <div style={{ fontSize: 36, fontWeight: 800, margin: "4px 0" }}>
              {currentLevel > 8 ? "MAX" : currentLevel}
            </div>
            {data.levelTitle && (
              <div style={{ fontSize: 16, opacity: 0.8 }}>{data.levelTitle}</div>
            )}
            {currentLevel > 8 && (
              <div style={{ fontSize: 14, opacity: 0.6, marginTop: 4 }}>
                All levels complete! You are a true Pizza Don.
              </div>
            )}
          </div>
        )}

        {/* Admin Review Panel */}
        {isAuthenticated && <MissionReviewPanel />}

        {/* Level Accordion */}
        {levels.map((levelData) => {
          const isExpanded = expandedLevels.has(levelData.level);
          const isCurrentLevel = levelData.level === currentLevel;
          const isUnlocked = levelData.level <= currentLevel;
          const isComplete =
            levelData.missions.length > 0 &&
            levelData.missions.every((m) => m.progress?.status === "APPROVED");

          const completedCount = levelData.missions.filter(
            (m) => m.progress?.status === "APPROVED"
          ).length;

          const title = levelData.title || LEVEL_TITLES[levelData.level] || null;

          return (
            <div key={levelData.level} style={{ ...card(), padding: 0, overflow: "hidden" }}>
              {/* Level Header */}
              <button
                onClick={() => toggleLevel(levelData.level)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "16px 20px",
                  background: isCurrentLevel
                    ? "var(--color-surface-hover)"
                    : "transparent",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  color: "inherit",
                  textAlign: "left",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 800,
                      fontSize: 16,
                      background: isComplete
                        ? "#16a34a"
                        : isCurrentLevel
                          ? "var(--color-btn-primary-bg)"
                          : "var(--color-border)",
                      color: isComplete || isCurrentLevel
                        ? "#fff"
                        : "var(--color-text-secondary)",
                      flexShrink: 0,
                    }}
                  >
                    {isComplete ? "\u2713" : levelData.level}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>
                      Level {levelData.level}
                      {title && (
                        <span style={{ fontWeight: 400, opacity: 0.6, marginLeft: 8 }}>
                          {title}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.5, marginTop: 2 }}>
                      {completedCount}/{levelData.missions.length} missions &middot;{" "}
                      {levelData.reward.toLocaleString()} $PEP
                    </div>
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 18,
                    opacity: 0.4,
                    transition: "transform 0.2s",
                    transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                  }}
                >
                  &#9660;
                </span>
              </button>

              {/* Level Content */}
              {isExpanded && (
                <div style={{ padding: "0 20px 16px", display: "grid", gap: 8 }}>
                  {!isUnlocked && (
                    <div
                      style={{
                        textAlign: "center",
                        padding: 16,
                        fontSize: 13,
                        opacity: 0.5,
                        fontStyle: "italic",
                      }}
                    >
                      Complete Level {levelData.level - 1} to unlock these missions
                    </div>
                  )}
                  {levelData.missions.map((mission) => (
                    <MissionCard
                      key={mission.id}
                      mission={mission}
                      levelUnlocked={isUnlocked}
                      onSubmit={handleSubmit}
                    />
                  ))}
                  {isComplete && (
                    <div
                      style={{
                        textAlign: "center",
                        padding: 12,
                        fontSize: 14,
                        color: "#16a34a",
                        fontWeight: 600,
                      }}
                    >
                      Level Complete! +{levelData.reward.toLocaleString()} $PEP earned
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Footer */}
        <div style={{ textAlign: "center", opacity: 0.4, fontSize: 13, marginTop: 20 }}>
          PizzaDAO
        </div>
      </div>
    </div>
  );
}
